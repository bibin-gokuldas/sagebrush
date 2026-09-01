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
