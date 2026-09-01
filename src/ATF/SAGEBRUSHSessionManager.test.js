// ATF Test: SAGEBRUSHSessionManager
var mgr = new SAGEBRUSHSessionManager();
var testUserId = gs.getUserID();

// Test 1: createSession returns a sys_id
var sessionId = mgr.createSession(testUserId, 'nowassist');
gs.assertTrue(sessionId !== null && sessionId.length === 32, 'createSession should return a 32-char sys_id');

// Test 2: getSession returns correct data
var session = mgr.getSession(sessionId);
gs.assertTrue(session !== null, 'getSession should return session data');
gs.assertTrue(session.channel === 'nowassist', 'channel should match');
gs.assertTrue(session.state === 'active', 'new session state should be active');
gs.assertTrue(session.intent === 'none', 'new session intent should be none');

// Test 3: updateIntent changes intent
var updated = mgr.updateIntent(sessionId, 'solution_design');
gs.assertTrue(updated === true, 'updateIntent should return true on success');
var updatedSession = mgr.getSession(sessionId);
gs.assertTrue(updatedSession.intent === 'solution_design', 'intent should be updated');

// Cleanup
var gr = new GlideRecord('x_snc_sagebrush_session');
gr.get(sessionId);
gr.deleteRecord();
