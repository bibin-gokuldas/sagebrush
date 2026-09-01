# SAGEBRUSH Architect Guide

**Audience:** ServiceNow Architects/Developers with `x_snc_sagebrush.architect` role
**Short Description:** Using SAGEBRUSH for Solution Design and advanced DQ analysis

---

## 1. Invoking SAGEBRUSH

**Now Assist:** Open Now Assist panel → type "SAGEBRUSH"
**Virtual Agent:** Open VA → say or type "SAGEBRUSH"
**Phone (if Dialogflow configured):** Call the Dialogflow phone number → say "SAGEBRUSH"

---

## 2. Solution Design Workflow

### Step 1 — Describe requirements
Tell SAGEBRUSH what you're building:
> "I need to automate incident routing using CMDB CI relationships and send Teams notifications on P1 incidents"

SAGEBRUSH extracts numbered requirements and plays them back for confirmation.

### Step 2 — Confirm
> "That's correct" or "Add: also need SLA tracking per CI tier"

SAGEBRUSH confirms all requirements and triggers the design engine.

### Step 3 — Review outputs
- **HLD:** KB article tagged `sagebrush-hld` — executive summary, architecture diagram, phases
- **LLD:** KB article tagged `sagebrush-lld` — table design, flow specs, Script Include signatures, ACL matrix, test scenarios

Find outputs: **Knowledge → Articles → filter tag = sagebrush-hld**

---

## 3. Data Quality — Architect View

As an architect, SAGEBRUSH gives you:
- Full technical detail: table name, field, GlideRecord query to reproduce the issue
- Fix script suggestions
- Cross-domain impact analysis

Example interaction:
> "SAGEBRUSH, run a GRC data quality check"

Result: "Found 3 critical issues: 8 risks have no linked control (sn_risk_risk — risk_control field empty). GlideRecord to reproduce: `var gr = new GlideRecord('sn_risk_risk'); gr.addNullQuery('risk_control'); gr.query();`"

---

## 4. Extending SAGEBRUSH

### Adding DQ Checks
Insert a record into `x_snc_sagebrush_dq_check`:
- `check_type = query` (recommended) — write a GlideRecord query, set `target_table` and `check_query`
- Set `severity`, `domain`, `dimension`, `message_template`
- `check_type = script` is disabled (new Function prohibited) — use query type

### Adding OOB Capabilities
Insert into `x_snc_sagebrush_oob_capability` with `capability_name`, `description`, `priority_level`, `license_tier`, `keywords`

### AI Provider
All AI calls go through `SAGEBRUSHAIProvider.ask(prompt, context, domain)`.
- Returns: `{ success: Boolean, text: String, provider: String, tokens: Number }`
- Inject via dependency: `new SAGEBRUSHMyScript({ ai: new SAGEBRUSHAIProvider() })`

---

## 5. Script Include API Reference

| Script Include | Key Method | Returns |
|---------------|-----------|---------|
| SAGEBRUSHConversationHandler | `handleMessage(sessionId, message)` | `{ response, intent }` |
| SAGEBRUSHAIProvider | `ask(prompt, context, domain)` | `{ success, text, provider, tokens }` |
| SAGEBRUSHDQEngine | `startRun(sessionId, domain)` | String runSysId |
| SAGEBRUSHDQEngine | `getSummary(runSysId, userId)` | String (role-appropriate) |
| SAGEBRUSHDQRemediator | `getHint(resultSysId, userId)` | String hint |
| SAGEBRUSHDesignWriter | `generateHLD(sessionId)` | String KB article sys_id |
| SAGEBRUSHDesignWriter | `generateLLD(sessionId, hldSysId)` | String KB article sys_id |
| SAGEBRUSHDataMasker | `mask(obj)` | `{ maskedData, tokenMap }` |
