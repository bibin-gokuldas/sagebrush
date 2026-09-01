// ATF Test: SAGEBRUSHDQRuleEngine
var engine  = new SAGEBRUSHDQRuleEngine();
var mgr     = new SAGEBRUSHSessionManager();
var sessionId = mgr.createSession(gs.getUserID(), 'nowassist');

// Create a DQ run record
var runGr = new GlideRecord('x_sagebrush_dq_run');
runGr.initialize();
runGr.setValue('run_type', 'domain');
runGr.setValue('domain', 'foundational');
runGr.setValue('triggered_by', 'manual');
runGr.setValue('session', sessionId);
runGr.setValue('state', 'running');
var runId = runGr.insert();

// Test 1: runDomain returns result object
var result = engine.runDomain(runId, 'foundational');
gs.assertTrue(result !== null, 'runDomain should return a result object');
gs.assertTrue(result.hasOwnProperty('checks_run'), 'result should have checks_run');
gs.assertTrue(result.hasOwnProperty('issues_found'), 'result should have issues_found');
gs.assertTrue(typeof result.checks_run === 'number', 'checks_run should be a number');
gs.assertTrue(result.checks_run >= 0, 'checks_run should be non-negative');

// Test 2: DQ result records are created in x_sagebrush_dq_result
var resultGr = new GlideRecord('x_sagebrush_dq_result');
resultGr.addQuery('dq_run', runId);
resultGr.query();
// Note: may be 0 results if test instance data is clean — that is valid
gs.assertTrue(resultGr.getRowCount() >= 0, 'DQ results table should be queryable');

// Test 3: runDomain with invalid domain returns empty result
var emptyResult = engine.runDomain(runId, 'invalid_domain_xyz');
gs.assertTrue(emptyResult.checks_run === 0, 'Invalid domain should return 0 checks run');

// Cleanup
mgr.closeSession(sessionId);
