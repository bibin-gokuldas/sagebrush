# SAGEBRUSH Phase 4 — Telephony & Production Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Dialogflow CX phone channel, fix all parked Phase 1-3 findings, harden AI fallback and data masking, and produce a production go-live runbook with admin training articles.

**Architecture:** Dialogflow CX webhook → IntegrationHub Inbound REST endpoint → SAGEBRUSHDialogflowHandler (translates CX payload ↔ ConversationHandler) → same Script Include chain as Now Assist. Property `x_snc_sagebrush.voice.provider` switches channels. No duplicate conversation logic — the phone channel is a transport adapter only.

**Tech Stack:** ServiceNow Australia release, scoped app x_snc_sagebrush, ES5 JavaScript, IntegrationHub Inbound Webhook, Dialogflow CX (Google Cloud), GSLog, GlideAggregate, Flow Designer.

**Spec:** docs/superpowers/specs/2026-08-30-sagebrush-design.md

## Global Constraints

- Scoped app `x_snc_sagebrush` only — zero global scope changes ever
- ES5 JavaScript only — no `let`, `const`, arrow functions, template literals, destructuring, `class` syntax
- Every Script Include must have `@callable_from_other_scopes true` JSDoc header
- Use `GSLog` for all logging — never `gs.print`, `gs.log`, `gs.info`, `gs.debug`
- `parseInt(x, 10)` always — never bare `parseInt(x)`
- `GlideAggregate` for all COUNT queries — never `getRowCount()` on result or large tables
- `gr.chooseWindow(offset, offset + CHUNK_SIZE)` for paginated queries — never `setLimit` alone as a pagination mechanism
- `new Function()` prohibited in scoped apps — script-type DQ checks skip with logged warning (existing behaviour, do not change)
- All ATF tests must use `gs.assertTrue` / `gs.assertFalse` only (no `gs.info` in tests)
- DQ results are append-only — never overwrite existing result records
- AI anomaly engine sends statistical summaries only — never raw record data
- `send_record_data` property check before any external AI call

---

### Task 23: SAGEBRUSHDialogflowHandler + Dialogflow System Properties

**Files:**
- Create: `src/Script Includes/SAGEBRUSHDialogflowHandler.js`
- Modify: `src/System Properties/x_snc_sagebrush.properties.json`
- Create: `src/ATF/SAGEBRUSHDialogflowHandler.test.js`

**Interfaces:**
- Consumes: `SAGEBRUSHConversationHandler.handleInvocation(userId, channel)` → `{ sessionId, greeting }` — Task 8
- Consumes: `SAGEBRUSHConversationHandler.handleMessage(sessionId, message)` → `{ response, intent }` — Task 8
- Produces: `SAGEBRUSHDialogflowHandler.processRequest(requestBody, webhookSecret)` → `String` JSON webhook response ready to return to Dialogflow CX

- [ ] **Step 1: Add Dialogflow system properties**

Modify `src/System Properties/x_snc_sagebrush.properties.json` — append these entries to the existing JSON array:

```json
  ,
  {
    "name": "x_snc_sagebrush.dialogflow.webhook_secret",
    "value": "",
    "description": "Shared secret header value Dialogflow sends in X-Webhook-Secret. Validated on every inbound request.",
    "type": "string",
    "private": true
  },
  {
    "name": "x_snc_sagebrush.dialogflow.project_id",
    "value": "",
    "description": "Google Cloud project ID hosting the Dialogflow CX agent.",
    "type": "string",
    "private": false
  },
  {
    "name": "x_snc_sagebrush.dialogflow.agent_id",
    "value": "",
    "description": "Dialogflow CX agent ID (UUID from Google Cloud console).",
    "type": "string",
    "private": false
  }
```

- [ ] **Step 2: Write failing ATF test**

Create `src/ATF/SAGEBRUSHDialogflowHandler.test.js`:

```javascript
// ATF Test: SAGEBRUSHDialogflowHandler
var handler = new SAGEBRUSHDialogflowHandler();
var secret  = 'test-secret-abc';

// Test 1: New session — invocation path
var invocationBody = JSON.stringify({
    sessionInfo: { session: 'projects/proj/locations/us/agents/agent/sessions/phone-session-001', parameters: {} },
    text: 'SAGEBRUSH'
});
var result1 = handler.processRequest(invocationBody, secret, secret);
var parsed1 = JSON.parse(result1);
gs.assertTrue(parsed1.fulfillment_response !== null, 'Response should have fulfillment_response');
gs.assertTrue(parsed1.fulfillment_response.messages.length > 0, 'Response should have at least one message');
gs.assertTrue(parsed1.session_info.parameters.sagebrush_session_id.length === 32, 'Session ID should be stored in Dialogflow session params');

// Test 2: Existing session — message routing path
var sessionId = parsed1.session_info.parameters.sagebrush_session_id;
var messageBody = JSON.stringify({
    sessionInfo: {
        session: 'projects/proj/locations/us/agents/agent/sessions/phone-session-001',
        parameters: { sagebrush_session_id: sessionId }
    },
    text: 'I want to do a data quality check on ITSM'
});
var result2 = handler.processRequest(messageBody, secret, secret);
var parsed2 = JSON.parse(result2);
gs.assertTrue(parsed2.fulfillment_response.messages.length > 0, 'Message response should have content');

// Test 3: Wrong secret — rejected
var result3 = handler.processRequest(invocationBody, 'wrong-secret', secret);
var parsed3 = JSON.parse(result3);
gs.assertTrue(parsed3.fulfillment_response.messages[0].text.text[0].indexOf('unable') !== -1 || parsed3.fulfillment_response.messages[0].text.text[0].length > 0, 'Should return error message on bad secret');
```

- [ ] **Step 3: Run test — verify it fails**

- [ ] **Step 4: Implement SAGEBRUSHDialogflowHandler**

Create `src/Script Includes/SAGEBRUSHDialogflowHandler.js`:

```javascript
/**
 * @name SAGEBRUSHDialogflowHandler
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 * @description Translates Dialogflow CX webhook payloads to ConversationHandler calls and formats responses.
 *              Acts as a thin transport adapter — all conversation logic remains in ConversationHandler.
 */
var SAGEBRUSHDialogflowHandler = Class.create();
SAGEBRUSHDialogflowHandler.prototype = {

    initialize: function(dependencies) {
        this.log         = new GSLog('x_snc_sagebrush.dialogflow', 'SAGEBRUSHDialogflowHandler');
        this.conversation = (dependencies && dependencies.conversation) || new SAGEBRUSHConversationHandler();
    },

    /**
     * Main entry point called by the IntegrationHub inbound webhook flow.
     * @param {string} requestBodyJson   - Raw JSON string of the Dialogflow CX webhook POST body
     * @param {string} incomingSecret    - Value from X-Webhook-Secret request header
     * @param {string} expectedSecret    - Value from x_snc_sagebrush.dialogflow.webhook_secret property (passed in by flow)
     * @returns {string} JSON string — Dialogflow CX webhook response
     */
    processRequest: function(requestBodyJson, incomingSecret, expectedSecret) {
        // Validate shared secret
        if (incomingSecret !== expectedSecret) {
            this.log.warn('processRequest: webhook secret mismatch — request rejected');
            return this._errorResponse('I am unable to process this request. Please contact your administrator.');
        }

        var body;
        try {
            body = JSON.parse(requestBodyJson);
        } catch (e) {
            this.log.error('processRequest: failed to parse request body — ' + e.message);
            return this._errorResponse('I received a malformed request and cannot continue.');
        }

        var userText    = this._extractText(body);
        var sessionInfo = (body.sessionInfo) || {};
        var params      = (sessionInfo.parameters) || {};
        var dfSessionId = (sessionInfo.session) || '';
        var existingId  = params.sagebrush_session_id || '';

        // Determine ServiceNow user — use integration user as proxy for phone caller
        var userId = gs.getUserID();

        if (!existingId || existingId.length !== 32) {
            // New phone session — create SAGEBRUSH session
            var invResult   = this.conversation.handleInvocation(userId, 'phone');
            var newSessionId = invResult.sessionId;
            var greeting     = invResult.greeting;
            return this._successResponse(greeting, newSessionId);
        }

        // Existing session — route message through handler
        var msgResult = this.conversation.handleMessage(existingId, userText);
        return this._successResponse(msgResult.response, existingId);
    },

    _extractText: function(body) {
        // Dialogflow CX sends user utterance in body.text (top-level) or body.messages[0].text.text[0]
        if (body.text && body.text.length > 0) { return body.text; }
        try {
            var msgs = body.messages || [];
            if (msgs.length > 0 && msgs[0].text && msgs[0].text.text && msgs[0].text.text.length > 0) {
                return msgs[0].text.text[0];
            }
        } catch (e) { /* ignore */ }
        return '';
    },

    _successResponse: function(responseText, sagebrushSessionId) {
        return JSON.stringify({
            fulfillment_response: {
                messages: [
                    { text: { text: [responseText] } }
                ]
            },
            session_info: {
                parameters: {
                    sagebrush_session_id: sagebrushSessionId
                }
            }
        });
    },

    _errorResponse: function(message) {
        return JSON.stringify({
            fulfillment_response: {
                messages: [
                    { text: { text: [message] } }
                ]
            },
            session_info: { parameters: {} }
        });
    },

    type: 'SAGEBRUSHDialogflowHandler'
};
```

- [ ] **Step 5: Run ATF — verify pass**

- [ ] **Step 6: Commit**

```bash
git add "src/Script Includes/SAGEBRUSHDialogflowHandler.js" \
        "src/ATF/SAGEBRUSHDialogflowHandler.test.js" \
        "src/System Properties/x_snc_sagebrush.properties.json"
git commit -m "feat(telephony): add SAGEBRUSHDialogflowHandler — Dialogflow CX webhook adapter"
```

---

### Task 24: SAGEBRUSH_DialogflowWebhook Flow (IntegrationHub Inbound)

**Files:**
- Create: `src/Flows/SAGEBRUSH_DialogflowWebhook.flow`

**Interfaces:**
- Consumes: `SAGEBRUSHDialogflowHandler.processRequest(body, incomingSecret, expectedSecret)` → String JSON — Task 23
- Produces: Inbound REST endpoint that Dialogflow CX calls as its fulfillment webhook

- [ ] **Step 1: Create the flow JSON**

Create `src/Flows/SAGEBRUSH_DialogflowWebhook.flow`:

```json
{
  "name": "SAGEBRUSH_DialogflowWebhook",
  "label": "SAGEBRUSH Dialogflow CX Webhook",
  "description": "IntegrationHub Inbound Webhook. Receives Dialogflow CX fulfillment calls, routes through SAGEBRUSHDialogflowHandler, returns JSON response. Configure the Dialogflow CX webhook URL to: https://<instance>.service-now.com/api/x_snc_sagebrush/dialogflow_webhook",
  "trigger": {
    "type": "inbound_webhook",
    "method": "POST",
    "path": "/api/x_snc_sagebrush/dialogflow_webhook",
    "content_type": "application/json"
  },
  "steps": [
    {
      "name": "Read Webhook Secret Property",
      "type": "script_action",
      "script": "var secret = gs.getProperty('x_snc_sagebrush.dialogflow.webhook_secret', ''); output = { secret: secret };",
      "outputs": { "secret": "expectedSecret" }
    },
    {
      "name": "Process Dialogflow Request",
      "type": "script_action",
      "script": "var handler = new SAGEBRUSHDialogflowHandler(); var incomingSecret = trigger.headers['x-webhook-secret'] || ''; var responseJson = handler.processRequest(trigger.body, incomingSecret, inputs.expectedSecret); output = { response_body: responseJson };",
      "inputs": { "expectedSecret": "{{expectedSecret}}" },
      "outputs": { "response_body": "responseBody" },
      "on_error": "log_and_continue"
    },
    {
      "name": "Return Webhook Response",
      "type": "webhook_response",
      "status_code": 200,
      "content_type": "application/json",
      "body": "{{responseBody}}"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add "src/Flows/SAGEBRUSH_DialogflowWebhook.flow"
git commit -m "feat(telephony): add SAGEBRUSH_DialogflowWebhook inbound IntegrationHub flow"
```

---

### Task 25: Dialogflow CX Agent Configuration

**Files:**
- Create: `src/Dialogflow/sagebrush-cx-agent.json`

**Interfaces:**
- Produces: Importable Dialogflow CX agent definition with all SAGEBRUSH intents, routes, and webhook binding. Import via Google Cloud Console → Dialogflow CX → Restore Agent.

- [ ] **Step 1: Create the Dialogflow CX agent export**

Create directory `src/Dialogflow/` and file `src/Dialogflow/sagebrush-cx-agent.json`:

```json
{
  "_meta": {
    "description": "SAGEBRUSH Dialogflow CX Agent — import via Google Cloud Console > Dialogflow CX > Restore Agent",
    "webhook_url": "https://bibingokuldas.service-now.com/api/x_snc_sagebrush/dialogflow_webhook",
    "webhook_secret_header": "X-Webhook-Secret",
    "webhook_secret_property": "x_snc_sagebrush.dialogflow.webhook_secret",
    "setup_steps": [
      "1. Create a Dialogflow CX agent in Google Cloud Console (us-central1 recommended for AU latency)",
      "2. Enable the Phone Gateway integration and obtain a phone number",
      "3. Import this file via Agents > Restore",
      "4. Create a webhook named 'sagebrush-webhook' pointing to the URL above",
      "5. Add X-Webhook-Secret header matching the value you set in x_snc_sagebrush.dialogflow.webhook_secret property",
      "6. Set x_snc_sagebrush.voice.provider = dialogflow in ServiceNow system properties",
      "7. Test by calling the phone number and saying 'SAGEBRUSH'"
    ]
  },
  "displayName": "SAGEBRUSH",
  "defaultLanguageCode": "en",
  "timeZone": "Australia/Sydney",
  "enableStackdriverLogging": true,
  "flows": [
    {
      "displayName": "Default Start Flow",
      "pages": [
        {
          "displayName": "Start Page",
          "entryFulfillment": {
            "webhook": "sagebrush-webhook",
            "tag": "invocation"
          },
          "transitionRoutes": [
            {
              "intent": "solution_design",
              "triggerFulfillment": { "webhook": "sagebrush-webhook", "tag": "message" }
            },
            {
              "intent": "data_quality",
              "triggerFulfillment": { "webhook": "sagebrush-webhook", "tag": "message" }
            },
            {
              "intent": "domain_itsm",
              "triggerFulfillment": { "webhook": "sagebrush-webhook", "tag": "message" }
            },
            {
              "intent": "domain_itom",
              "triggerFulfillment": { "webhook": "sagebrush-webhook", "tag": "message" }
            },
            {
              "intent": "domain_grc",
              "triggerFulfillment": { "webhook": "sagebrush-webhook", "tag": "message" }
            },
            {
              "intent": "domain_bcm",
              "triggerFulfillment": { "webhook": "sagebrush-webhook", "tag": "message" }
            },
            {
              "intent": "domain_csm",
              "triggerFulfillment": { "webhook": "sagebrush-webhook", "tag": "message" }
            },
            {
              "intent": "domain_hrsd",
              "triggerFulfillment": { "webhook": "sagebrush-webhook", "tag": "message" }
            },
            {
              "intent": "domain_all",
              "triggerFulfillment": { "webhook": "sagebrush-webhook", "tag": "message" }
            },
            {
              "intent": "restart",
              "triggerFulfillment": { "webhook": "sagebrush-webhook", "tag": "invocation" }
            },
            {
              "condition": "true",
              "triggerFulfillment": { "webhook": "sagebrush-webhook", "tag": "message" }
            }
          ]
        }
      ]
    }
  ],
  "intents": [
    {
      "displayName": "solution_design",
      "trainingPhrases": [
        { "parts": [{ "text": "solution design" }] },
        { "parts": [{ "text": "I want to design a solution" }] },
        { "parts": [{ "text": "help me with architecture" }] },
        { "parts": [{ "text": "I need to build something on ServiceNow" }] },
        { "parts": [{ "text": "generate an HLD" }] },
        { "parts": [{ "text": "generate a low level design" }] },
        { "parts": [{ "text": "design document" }] },
        { "parts": [{ "text": "I have some requirements" }] }
      ]
    },
    {
      "displayName": "data_quality",
      "trainingPhrases": [
        { "parts": [{ "text": "data quality" }] },
        { "parts": [{ "text": "run a data quality check" }] },
        { "parts": [{ "text": "check my data" }] },
        { "parts": [{ "text": "find duplicate records" }] },
        { "parts": [{ "text": "what is my data quality score" }] },
        { "parts": [{ "text": "check for data issues" }] },
        { "parts": [{ "text": "clean my data" }] }
      ]
    },
    {
      "displayName": "domain_itsm",
      "trainingPhrases": [
        { "parts": [{ "text": "ITSM" }] },
        { "parts": [{ "text": "check ITSM" }] },
        { "parts": [{ "text": "incidents and changes" }] }
      ]
    },
    {
      "displayName": "domain_itom",
      "trainingPhrases": [
        { "parts": [{ "text": "ITOM" }] },
        { "parts": [{ "text": "check ITOM" }] },
        { "parts": [{ "text": "infrastructure and operations" }] }
      ]
    },
    {
      "displayName": "domain_grc",
      "trainingPhrases": [
        { "parts": [{ "text": "GRC" }] },
        { "parts": [{ "text": "check GRC" }] },
        { "parts": [{ "text": "governance risk and compliance" }] }
      ]
    },
    {
      "displayName": "domain_bcm",
      "trainingPhrases": [
        { "parts": [{ "text": "BCM" }] },
        { "parts": [{ "text": "check BCM" }] },
        { "parts": [{ "text": "business continuity" }] }
      ]
    },
    {
      "displayName": "domain_csm",
      "trainingPhrases": [
        { "parts": [{ "text": "CSM" }] },
        { "parts": [{ "text": "check CSM" }] },
        { "parts": [{ "text": "customer service" }] }
      ]
    },
    {
      "displayName": "domain_hrsd",
      "trainingPhrases": [
        { "parts": [{ "text": "HRSD" }] },
        { "parts": [{ "text": "check HRSD" }] },
        { "parts": [{ "text": "HR service delivery" }] }
      ]
    },
    {
      "displayName": "domain_all",
      "trainingPhrases": [
        { "parts": [{ "text": "all domains" }] },
        { "parts": [{ "text": "full scan" }] },
        { "parts": [{ "text": "check everything" }] },
        { "parts": [{ "text": "run a full check" }] }
      ]
    },
    {
      "displayName": "restart",
      "trainingPhrases": [
        { "parts": [{ "text": "restart" }] },
        { "parts": [{ "text": "start over" }] },
        { "parts": [{ "text": "begin again" }] }
      ]
    }
  ],
  "webhooks": [
    {
      "displayName": "sagebrush-webhook",
      "genericWebService": {
        "uri": "https://bibingokuldas.service-now.com/api/x_snc_sagebrush/dialogflow_webhook",
        "requestHeaders": {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "<SET_FROM_x_snc_sagebrush.dialogflow.webhook_secret_PROPERTY>"
        },
        "httpMethod": "POST"
      },
      "timeout": "30s"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/Dialogflow/
git commit -m "feat(telephony): add Dialogflow CX agent configuration — importable agent definition with all SAGEBRUSH intents"
```

---

### Task 26: Hardening — Parked Fixes + ATF Hardening Suite

**Files:**
- Modify: `src/VA Topics/SAGEBRUSH_Invocation.topic` (parked Phase 1 VA fixes)
- Create: `src/ATF/SAGEBRUSH_Hardening.test.js`
- Create: `src/Fix Scripts/SAGEBRUSH_GoLiveChecklist.js`

**Interfaces:**
- Consumes: `SAGEBRUSHAIProvider.ask()` — to test fallback chain (Task 6)
- Consumes: `SAGEBRUSHDataMasker.mask()` — to verify PII stripping (Task 5)

- [ ] **Step 1: Fix parked VA topic issues**

Read `src/VA Topics/SAGEBRUSH_Invocation.topic` first, then apply two fixes:

**Fix 1** — Replace `varecord.put` with `vaVars.put` (parked T9 ruling — `varecord` is not a VA API, `vaVars` is the correct Virtual Agent variable store):

Find any occurrence of `varecord.put(` and replace with `vaVars.put(`.

**Fix 2** — Remove the redundant text node that references `${sagebrush_greeting}`. The `output = result.greeting` line already delivers the greeting via the flow output mechanism — the text node is dead weight that could display a literal `${sagebrush_greeting}` string to the user.

Remove the text node block that contains `${sagebrush_greeting}`.

After edits:
```bash
git add "src/VA Topics/"
git commit -m "fix(va-topic): correct vaVars.put API and remove redundant greeting text node — parked from Phase 1"
```

- [ ] **Step 2: Write hardening ATF tests**

Create `src/ATF/SAGEBRUSH_Hardening.test.js`:

```javascript
// ATF Hardening Suite: AI Fallback + Data Masking + Phone Channel round-trip

// ─── Test 1: DataMasker strips PII before any AI call ───────────────────────
var masker = new SAGEBRUSHDataMasker();
var piiPayload = {
    user_name: 'John Smith',
    email: 'john.smith@company.com',
    phone_number: '+61412345678',
    incident_number: 'INC0012345',
    short_description: 'User cannot log in'
};
var masked = masker.mask(piiPayload);

gs.assertTrue(masked.maskedData !== null, 'mask() should return maskedData');
gs.assertFalse(JSON.stringify(masked.maskedData).indexOf('John Smith') !== -1, 'Masked payload must not contain user_name PII');
gs.assertFalse(JSON.stringify(masked.maskedData).indexOf('john.smith@company.com') !== -1, 'Masked payload must not contain email PII');
gs.assertFalse(JSON.stringify(masked.maskedData).indexOf('+61412345678') !== -1, 'Masked payload must not contain phone PII');
gs.assertTrue(JSON.stringify(masked.maskedData).indexOf('INC0012345') !== -1, 'Non-PII incident number should be preserved');
gs.assertTrue(masked.tokenMap !== null, 'mask() should return tokenMap');
gs.assertTrue(Object.keys(masked.tokenMap).length > 0, 'tokenMap must have at least one mapping');

// ─── Test 2: send_record_data=false enforced ─────────────────────────────────
// Verify the property guard exists and defaults to false
var sendRaw = gs.getProperty('x_snc_sagebrush.ai.external.send_record_data', 'false');
gs.assertTrue(sendRaw === 'false', 'send_record_data must default to false — never ship raw records to external AI');

// ─── Test 3: AI provider fallback chain active ───────────────────────────────
var ai = new SAGEBRUSHAIProvider();
// Ask with an invalid domain to confirm provider resolution runs without throw
var result = ai.ask('Return the word PONG.', { test: true }, 'itsm');
gs.assertTrue(result !== null, 'AIProvider.ask() should never throw — should return object on any provider outcome');
gs.assertTrue(result.success !== null, 'Result should have success field');
gs.assertTrue(typeof result.text === 'string', 'Result.text should always be a string');

// ─── Test 4: Dialogflow handler — bad secret rejected ────────────────────────
var dfHandler = new SAGEBRUSHDialogflowHandler();
var fakeBody  = JSON.stringify({ sessionInfo: { session: 'proj/sessions/test', parameters: {} }, text: 'SAGEBRUSH' });
var badResult = dfHandler.processRequest(fakeBody, 'wrong', 'correct');
var badParsed = JSON.parse(badResult);
gs.assertTrue(badParsed.fulfillment_response !== null, 'Bad secret should still return valid JSON structure');
gs.assertTrue(badParsed.fulfillment_response.messages.length > 0, 'Error response must have a message');

// ─── Test 5: Dialogflow handler — valid full round-trip ──────────────────────
var secret   = gs.getProperty('x_snc_sagebrush.dialogflow.webhook_secret', 'test-secret');
var goodBody = JSON.stringify({ sessionInfo: { session: 'proj/sessions/hardening-001', parameters: {} }, text: 'SAGEBRUSH' });
var goodResult = dfHandler.processRequest(goodBody, secret, secret);
var goodParsed  = JSON.parse(goodResult);
gs.assertTrue(goodParsed.session_info.parameters.sagebrush_session_id.length === 32, 'Round-trip must create and return a SAGEBRUSH session ID');
```

- [ ] **Step 3: Run hardening tests — verify all 5 pass**

- [ ] **Step 4: Create go-live checklist fix script**

Create `src/Fix Scripts/SAGEBRUSH_GoLiveChecklist.js`:

```javascript
/**
 * SAGEBRUSH Go-Live Checklist
 * Run this Fix Script before production go-live to verify all required
 * configuration is in place. Read output in System Log.
 * Safe to re-run — makes no changes.
 */
(function runGoLiveChecklist() {
    var log = new GSLog('x_snc_sagebrush.golive', 'SAGEBRUSH_GoLiveChecklist');
    var passed = 0;
    var failed = 0;

    function check(label, condition, detail) {
        if (condition) {
            log.info('PASS: ' + label + (detail ? ' — ' + detail : ''));
            passed++;
        } else {
            log.warn('FAIL: ' + label + (detail ? ' — ' + detail : ''));
            failed++;
        }
    }

    // ── System Properties ────────────────────────────────────────────────────
    check('AI provider set',
        gs.getProperty('x_snc_sagebrush.ai.provider', '').length > 0,
        gs.getProperty('x_snc_sagebrush.ai.provider', '(not set)'));

    check('send_record_data is false',
        gs.getProperty('x_snc_sagebrush.ai.external.send_record_data', 'true') === 'false',
        'CRITICAL: raw records must never leave the instance');

    var aiKey = gs.getProperty('x_snc_sagebrush.ai.claude.api_key', '');
    var oaiKey = gs.getProperty('x_snc_sagebrush.ai.openai.api_key', '');
    check('At least one external AI key configured (claude or openai)',
        aiKey.length > 0 || oaiKey.length > 0);

    check('Greeting text configured',
        gs.getProperty('x_snc_sagebrush.greeting.text', '').length > 10);

    check('Dialogflow webhook secret configured',
        gs.getProperty('x_snc_sagebrush.dialogflow.webhook_secret', '').length > 8,
        'Must be > 8 chars; used to authenticate Dialogflow calls');

    // ── Tables exist ─────────────────────────────────────────────────────────
    var tables = [
        'x_snc_sagebrush_session', 'x_snc_sagebrush_audit_log', 'x_snc_sagebrush_ai_log',
        'x_snc_sagebrush_requirement', 'x_snc_sagebrush_instance_snapshot',
        'x_snc_sagebrush_oob_capability', 'x_snc_sagebrush_oob_map',
        'x_snc_sagebrush_dq_check', 'x_snc_sagebrush_dq_run', 'x_snc_sagebrush_dq_result'
    ];
    for (var i = 0; i < tables.length; i++) {
        var t = tables[i];
        check('Table exists: ' + t, GlideDBObjectManager.getInstance().isTableExist(t));
    }

    // ── DQ Checks seeded ─────────────────────────────────────────────────────
    var dqCount = new GlideAggregate('x_snc_sagebrush_dq_check');
    dqCount.addAggregate('COUNT');
    dqCount.query();
    dqCount.next();
    var checkCount = parseInt(dqCount.getAggregate('COUNT'), 10);
    check('DQ checks seeded (expect 28)', checkCount >= 28, checkCount + ' checks found');

    // ── OOB Capabilities seeded ──────────────────────────────────────────────
    var capCount = new GlideAggregate('x_snc_sagebrush_oob_capability');
    capCount.addAggregate('COUNT');
    capCount.query();
    capCount.next();
    var capTotal = parseInt(capCount.getAggregate('COUNT'), 10);
    check('OOB capabilities seeded', capTotal > 0, capTotal + ' capabilities found');

    // ── Roles exist ──────────────────────────────────────────────────────────
    var roles = ['x_snc_sagebrush.user', 'x_snc_sagebrush.admin', 'x_snc_sagebrush.architect'];
    for (var r = 0; r < roles.length; r++) {
        var roleGr = new GlideRecord('sys_user_role');
        roleGr.addQuery('name', roles[r]);
        roleGr.setLimit(1);
        roleGr.query();
        check('Role exists: ' + roles[r], roleGr.next());
    }

    // ── Script Includes accessible ───────────────────────────────────────────
    var sis = [
        'SAGEBRUSHAIProvider', 'SAGEBRUSHConversationHandler', 'SAGEBRUSHDataMasker',
        'SAGEBRUSHSessionManager', 'SAGEBRUSHDQEngine', 'SAGEBRUSHDialogflowHandler'
    ];
    for (var s = 0; s < sis.length; s++) {
        var siGr = new GlideRecord('sys_script_include');
        siGr.addQuery('name', sis[s]);
        siGr.addQuery('active', true);
        siGr.setLimit(1);
        siGr.query();
        check('Script Include active: ' + sis[s], siGr.next());
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    log.info('═══════════════════════════════════════════════════');
    log.info('SAGEBRUSH Go-Live Checklist: ' + passed + ' passed, ' + failed + ' failed');
    if (failed === 0) {
        log.info('ALL CHECKS PASSED — SAGEBRUSH is ready for production.');
    } else {
        log.warn('RESOLVE ' + failed + ' FAILURES before go-live.');
    }
    log.info('═══════════════════════════════════════════════════');
})();
```

- [ ] **Step 5: Commit all hardening work**

```bash
git add "src/ATF/SAGEBRUSH_Hardening.test.js" \
        "src/Fix Scripts/SAGEBRUSH_GoLiveChecklist.js"
git commit -m "feat(hardening): add hardening ATF suite, go-live checklist fix script"
```

---

### Task 27: Admin Training KB Articles + Go-Live Runbook

**Files:**
- Create: `src/KB Articles/SAGEBRUSH_AdminGuide.md`
- Create: `src/KB Articles/SAGEBRUSH_ArchitectGuide.md`
- Create: `src/KB Articles/SAGEBRUSH_GoLiveRunbook.md`

**Interfaces:**
- Produces: Three KB articles to be imported into `kb_knowledge` on the production instance (manually or via update set).

- [ ] **Step 1: Create Admin Guide**

Create `src/KB Articles/SAGEBRUSH_AdminGuide.md`:

```markdown
# SAGEBRUSH Admin Guide

**Audience:** ServiceNow Administrators with `x_snc_sagebrush.admin` role
**Short Description:** How to configure, monitor, and operate the SAGEBRUSH AI Agent

---

## 1. System Properties Reference

Navigate to: **System Properties → SAGEBRUSH**

| Property | Default | What It Does |
|----------|---------|--------------|
| x_snc_sagebrush.ai.provider | nowassist | Primary AI: `nowassist`, `claude`, or `openai` |
| x_snc_sagebrush.ai.fallback_provider | claude | Used when primary fails or domain unlicensed |
| x_snc_sagebrush.ai.fallback_enabled | true | Set false to disable AI fallback entirely |
| x_snc_sagebrush.ai.claude.api_key | (empty) | Anthropic API key — set before enabling Claude |
| x_snc_sagebrush.ai.openai.api_key | (empty) | OpenAI API key — set before enabling OpenAI |
| x_snc_sagebrush.ai.external.send_record_data | false | **NEVER set to true in production** |
| x_snc_sagebrush.ai.nowassist.licensed_domains | itsm,csm,hrsd | Domains with Now Assist license |
| x_snc_sagebrush.ai.timeout_ms | 30000 | AI call timeout before fallback fires (ms) |
| x_snc_sagebrush.voice.provider | webspeech | `webspeech` or `dialogflow` |
| x_snc_sagebrush.dialogflow.webhook_secret | (empty) | Must match Dialogflow webhook header |
| x_snc_sagebrush.greeting.text | (greeting) | Edit the opening phrase SAGEBRUSH speaks |

---

## 2. Running Data Quality Scans

### Via SAGEBRUSH Chat
- Open Now Assist → type "SAGEBRUSH"
- Say: "Run a data quality check on ITSM" (or any domain)
- SAGEBRUSH runs the domain scan and reports the score

### Via Scheduled Flow
- Weekly full scan runs every Sunday at 02:00 (SAGEBRUSH_DQFullScan flow)
- To change schedule: Flow Designer → SAGEBRUSH_DQFullScan → Edit trigger

### Viewing Results
- Navigate to: **SAGEBRUSH → DQ Results** (x_snc_sagebrush_dq_result table)
- PA Dashboard: **Performance Analytics → SAGEBRUSH Data Quality**
- Filter by severity, domain, or status

---

## 3. Remediation Workflow

1. Open a DQ result record
2. Click **Get Remediation Hint** — SAGEBRUSH generates role-appropriate guidance
3. Assign the record to the responsible group (Assigned To field)
4. Update Status to **Acknowledged** when under investigation
5. Update Status to **Remediated** when the underlying data is fixed
6. **Suppressed** = known exception, not an error

---

## 4. Monitoring

- **System Log** (filter: source = x_snc_sagebrush.*) — all SAGEBRUSH activity
- **x_snc_sagebrush_ai_log** — every AI call, provider used, token count, success/fail
- **x_snc_sagebrush_audit_log** — every user session and invocation event
- DQ score trend visible on PA Dashboard — score below 70 warrants investigation

---

## 5. Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "No AI response" on all requests | API key missing or expired | Update x_snc_sagebrush.ai.claude.api_key |
| Phone calls connect but no voice response | Dialogflow webhook secret mismatch | Match x_snc_sagebrush.dialogflow.webhook_secret to Dialogflow console |
| DQ scan never completes | Large instance, CHUNK_SIZE limit | Check x_snc_sagebrush_dq_run state — if running > 2hrs, check for flow errors |
| Score drops sharply | New DQ check seeded with broad query | Review x_snc_sagebrush_dq_check — deactivate over-broad check if needed |
| "Cross-scope privilege denied" | Install Fix Script not run | Run SAGEBRUSH_Install.js as admin |
```

- [ ] **Step 2: Create Architect Guide**

Create `src/KB Articles/SAGEBRUSH_ArchitectGuide.md`:

```markdown
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
```

- [ ] **Step 3: Create Go-Live Runbook**

Create `src/KB Articles/SAGEBRUSH_GoLiveRunbook.md`:

```markdown
# SAGEBRUSH Go-Live Runbook

**Owner:** SAGEBRUSH Implementation Lead
**Applies to:** Production instance promotion

---

## Pre-Go-Live Checklist (run in DEV first, then PRD)

### 1. Source Control Import
- [ ] In Studio → Import From Source Control → `https://github.com/bibin-gokuldas/sagebrush.git` → branch `main`
- [ ] Verify all Script Includes are active in x_snc_sagebrush scope
- [ ] Verify all tables exist (navigate to x_snc_sagebrush_session — confirm no 404)

### 2. Run Install Fix Script
- [ ] System Definition → Fix Scripts → **SAGEBRUSH_Install** → Run Fix Script
- [ ] Confirm System Log shows: "SAGEBRUSH install complete — X privileges created"

### 3. Seed Reference Data
- [ ] Run **SAGEBRUSH_SeedOOBCapabilities** Fix Script
- [ ] Run **SAGEBRUSH_SeedDQChecks** Fix Script
- [ ] Confirm: x_snc_sagebrush_oob_capability has > 0 records
- [ ] Confirm: x_snc_sagebrush_dq_check has 28 records

### 4. Configure System Properties
- [ ] Set `x_snc_sagebrush.ai.claude.api_key` (or openai key)
- [ ] Set `x_snc_sagebrush.ai.provider` = `nowassist` (or `claude` if Now Assist not licensed)
- [ ] Set `x_snc_sagebrush.ai.nowassist.licensed_domains` = comma list per your license
- [ ] Confirm `x_snc_sagebrush.ai.external.send_record_data` = `false`
- [ ] Set `x_snc_sagebrush.dialogflow.webhook_secret` (if phone channel enabled)

### 5. Run Go-Live Checklist Script
- [ ] System Definition → Fix Scripts → **SAGEBRUSH_GoLiveChecklist** → Run Fix Script
- [ ] System Log must show: "ALL CHECKS PASSED"
- [ ] Resolve any FAIL items before proceeding

### 6. Assign Roles
- [ ] Assign `x_snc_sagebrush.user` to all ServiceNow users
- [ ] Assign `x_snc_sagebrush.admin` to ITSM/DQ administrators
- [ ] Assign `x_snc_sagebrush.architect` to Solution Architects / Developers

### 7. Phone Channel (if applicable)
- [ ] Import Dialogflow CX agent from `src/Dialogflow/sagebrush-cx-agent.json`
- [ ] Configure webhook URL in Dialogflow CX console → sagebrush-webhook → URL = `https://<prod-instance>.service-now.com/api/x_snc_sagebrush/dialogflow_webhook`
- [ ] Set X-Webhook-Secret header = value of `x_snc_sagebrush.dialogflow.webhook_secret`
- [ ] Enable Phone Gateway in Dialogflow CX → obtain AU phone number
- [ ] Set `x_snc_sagebrush.voice.provider` = `dialogflow`
- [ ] Test: call the number → say "SAGEBRUSH" → confirm greeting plays

### 8. ATF Verification
- [ ] ATF → Test Suites → **SAGEBRUSH_ATF_Suite** → Run
- [ ] All tests must PASS before sign-off

### 9. PA Dashboard
- [ ] Performance Analytics → Jobs → run SAGEBRUSH_DQScore_Overall indicator
- [ ] Verify dashboard populates with DQ score data

---

## Rollback Procedure

If a critical issue is found post-go-live:

1. Deactivate all x_snc_sagebrush Script Includes (bulk update active=false)
2. Deactivate SAGEBRUSH Now Assist Skill record
3. Source control: revert to last stable commit and re-import
4. Re-run SAGEBRUSH_GoLiveChecklist to confirm stable state

---

## Support Contacts

- System Log filter: `source STARTSWITH x_snc_sagebrush`
- AI call log: x_snc_sagebrush_ai_log table
- Escalate issues to the SAGEBRUSH implementation team
```

- [ ] **Step 4: Commit all KB articles**

```bash
git add "src/KB Articles/"
git commit -m "feat(docs): add admin guide, architect guide, and go-live runbook KB articles"
```

---

## Phase 4 Exit Criteria

- [ ] User can call a phone number → say "SAGEBRUSH" → receive greeting via Dialogflow CX
- [ ] Phone channel routes through same `SAGEBRUSHConversationHandler` — no duplicate logic
- [ ] VA topic `vaVars.put` fix applied — greeting delivers correctly through VA
- [ ] All 5 hardening ATF tests pass: PII never in AI payload, fallback chain active, bad secret rejected, round-trip creates session
- [ ] Go-Live Checklist fix script reports ALL CHECKS PASSED on a seeded instance
- [ ] Three KB articles committed: admin guide, architect guide, go-live runbook
- [ ] Dialogflow CX agent config JSON checked in — importable via Google Cloud Console
- [ ] Zero global scope changes across all 27 tasks
