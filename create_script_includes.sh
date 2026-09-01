#!/bin/bash
# Usage: ./create_script_includes.sh <username> <password>
# Example: ./create_script_includes.sh admin MyPassword123

USER="$1"
PASS="$2"
INSTANCE="https://bibingokuldas.service-now.com"
SCOPE_SYS_ID="37abe07193074f10fb3a39018bba1060"

if [ -z "$USER" ] || [ -z "$PASS" ]; then
  echo "Usage: $0 <username> <password>"
  exit 1
fi

CREATED=0
UPDATED=0
FAILED=0

# Resolve the directory where this script lives so file paths are always correct
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

create_si() {
  local NAME="$1"
  local SCRIPT_FILE="$2"

  echo "Processing $NAME..."

  # Check if a Script Include with this name already exists
  EXISTING=$(curl -s -o /dev/null -w "%{http_code}" \
    "$INSTANCE/api/now/table/sys_script_include?sysparm_query=name%3D${NAME}%5Esys_scope%3D${SCOPE_SYS_ID}&sysparm_fields=sys_id&sysparm_limit=1" \
    -u "$USER:$PASS" \
    -H "Accept: application/json")

  EXISTING_BODY=$(curl -s \
    "$INSTANCE/api/now/table/sys_script_include?sysparm_query=name%3D${NAME}%5Esys_scope%3D${SCOPE_SYS_ID}&sysparm_fields=sys_id&sysparm_limit=1" \
    -u "$USER:$PASS" \
    -H "Accept: application/json")

  EXISTING_SYS_ID=$(echo "$EXISTING_BODY" | python3 -c "
import json, sys
data = json.load(sys.stdin)
results = data.get('result', [])
if results:
    print(results[0]['sys_id'])
else:
    print('')
" 2>/dev/null)

  # Build the JSON payload using Python to avoid all shell escaping issues
  PAYLOAD=$(python3 -c "
import json, sys
with open('$SCRIPT_FILE', 'r') as f:
    content = f.read()
payload = {
    'name': '$NAME',
    'api_name': 'x_snc_sagebrush.$NAME',
    'script': content,
    'active': 'true',
    'access': 'public',
    'client_callable': 'false',
    'callers_access': 'caller_tracking',
    'sys_scope': '$SCOPE_SYS_ID'
}
print(json.dumps(payload))
")

  if [ -n "$EXISTING_SYS_ID" ]; then
    # Record exists — PATCH it
    echo "  Record exists (sys_id: $EXISTING_SYS_ID) — updating..."
    RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH \
      "$INSTANCE/api/now/table/sys_script_include/$EXISTING_SYS_ID" \
      -u "$USER:$PASS" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -d "$PAYLOAD")

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -1)

    if [ "$HTTP_CODE" = "200" ]; then
      echo "  ✓ Updated $NAME"
      UPDATED=$((UPDATED + 1))
    else
      echo "  ✗ FAILED to update $NAME — HTTP $HTTP_CODE"
      echo "  Response: $(echo "$BODY" | head -c 200)"
      FAILED=$((FAILED + 1))
    fi
  else
    # Record does not exist — POST it
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
      "$INSTANCE/api/now/table/sys_script_include" \
      -u "$USER:$PASS" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -d "$PAYLOAD")

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -1)

    if [ "$HTTP_CODE" = "201" ]; then
      SYS_ID=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['sys_id'])" 2>/dev/null)
      echo "  ✓ Created $NAME (sys_id: $SYS_ID)"
      CREATED=$((CREATED + 1))
    elif [ "$HTTP_CODE" = "200" ]; then
      echo "  ✓ Created $NAME (200 OK)"
      CREATED=$((CREATED + 1))
    else
      echo "  ✗ FAILED $NAME — HTTP $HTTP_CODE"
      echo "  Response: $(echo "$BODY" | head -c 200)"
      FAILED=$((FAILED + 1))
    fi
  fi
}

# ---------------------------------------------------------------------------
# Call create_si for each of the 16 Script Includes
# ---------------------------------------------------------------------------

create_si "SAGEBRUSHAIProvider"          "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHAIProvider.js"
create_si "SAGEBRUSHAuditLogger"         "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHAuditLogger.js"
create_si "SAGEBRUSHConversationHandler" "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHConversationHandler.js"
create_si "SAGEBRUSHDataMasker"          "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHDataMasker.js"
create_si "SAGEBRUSHDesignWriter"        "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHDesignWriter.js"
create_si "SAGEBRUSHDialogflowHandler"   "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHDialogflowHandler.js"
create_si "SAGEBRUSHDQAIEngine"          "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHDQAIEngine.js"
create_si "SAGEBRUSHDQEngine"            "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHDQEngine.js"
create_si "SAGEBRUSHDQRemediator"        "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHDQRemediator.js"
create_si "SAGEBRUSHDQRuleEngine"        "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHDQRuleEngine.js"
create_si "SAGEBRUSHDQScorer"            "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHDQScorer.js"
create_si "SAGEBRUSHInstanceScanner"     "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHInstanceScanner.js"
create_si "SAGEBRUSHOOBMapper"           "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHOOBMapper.js"
create_si "SAGEBRUSHRequirementExtractor" "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHRequirementExtractor.js"
create_si "SAGEBRUSHRoleHelper"          "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHRoleHelper.js"
create_si "SAGEBRUSHSessionManager"      "$SCRIPT_DIR/src/Script Includes/SAGEBRUSHSessionManager.js"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Done — $CREATED created, $UPDATED updated, $FAILED failed"
