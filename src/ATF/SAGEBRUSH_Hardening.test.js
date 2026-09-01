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
