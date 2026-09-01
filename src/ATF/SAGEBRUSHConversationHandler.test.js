// ATF Test: SAGEBRUSHConversationHandler

// Test 1: handleInvocation creates session and returns greeting
var handler = new SAGEBRUSHConversationHandler();
var userId = gs.getUserID();

var invocation = handler.handleInvocation(userId, 'nowassist');
gs.assertTrue(invocation !== null, 'handleInvocation should return a result');
gs.assertTrue(invocation.sessionId !== null, 'sessionId should be set');
gs.assertTrue(invocation.sessionId.length === 32, 'sessionId should be 32 chars');
gs.assertTrue(typeof invocation.greeting === 'string', 'greeting should be a string');
gs.assertTrue(invocation.greeting.length > 0, 'greeting should not be empty');

// Test 2: handleMessage with solution_design intent
var msgResult = handler.handleMessage(invocation.sessionId, 'I want to do solution design');
gs.assertTrue(msgResult !== null, 'handleMessage should return a result');
gs.assertTrue(typeof msgResult.response === 'string', 'response should be a string');
gs.assertTrue(msgResult.intent === 'solution_design', 'intent should be solution_design');

// Test 3: handleMessage with data_quality intent — fresh session to avoid stickiness
var dqInvocation = handler.handleInvocation(userId, 'nowassist');
var dqResult = handler.handleMessage(dqInvocation.sessionId, 'run data quality check');
gs.assertTrue(dqResult.intent === 'data_quality', 'intent should be data_quality');

// Cleanup
var mgr = new SAGEBRUSHSessionManager();
mgr.closeSession(invocation.sessionId);
mgr.closeSession(dqInvocation.sessionId);
