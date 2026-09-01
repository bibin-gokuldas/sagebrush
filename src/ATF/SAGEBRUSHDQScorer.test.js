// ATF Test: SAGEBRUSHDQScorer
var scorer = new SAGEBRUSHDQScorer();

// Create a test run with known issues
var runGr = new GlideRecord('x_sagebrush_dq_run');
runGr.initialize();
runGr.setValue('run_type', 'domain');
runGr.setValue('domain', 'itsm');
runGr.setValue('triggered_by', 'manual');
runGr.setValue('state', 'complete');
runGr.setValue('checks_run', 10);
runGr.setValue('issues_found', 3);
runGr.setValue('critical_count', 1);
runGr.setValue('high_count', 1);
runGr.setValue('medium_count', 1);
runGr.setValue('low_count', 0);
var runId = runGr.insert();

// Test 1: scoreRun returns object with expected keys
var scores = scorer.scoreRun(runId);
gs.assertTrue(scores !== null, 'scoreRun should return scores');
gs.assertTrue(scores.hasOwnProperty('overall'), 'scores should have overall key');
gs.assertTrue(typeof scores.overall === 'number', 'overall should be a number');
gs.assertTrue(scores.overall >= 0 && scores.overall <= 100, 'overall score should be 0-100');

// Test 2: scoreDomain returns a number
var domainScore = scorer.scoreDomain(runId, 'itsm');
gs.assertTrue(typeof domainScore === 'number', 'scoreDomain should return number');
gs.assertTrue(domainScore >= 0 && domainScore <= 100, 'domain score should be 0-100');

// Test 3: perfect score when no issues
var cleanRun = new GlideRecord('x_sagebrush_dq_run');
cleanRun.initialize();
cleanRun.setValue('run_type', 'domain');
cleanRun.setValue('domain', 'hrsd');
cleanRun.setValue('triggered_by', 'manual');
cleanRun.setValue('state', 'complete');
cleanRun.setValue('checks_run', 5);
cleanRun.setValue('issues_found', 0);
cleanRun.setValue('critical_count', 0);
cleanRun.setValue('high_count', 0);
cleanRun.setValue('medium_count', 0);
cleanRun.setValue('low_count', 0);
var cleanRunId = cleanRun.insert();

var perfectScore = scorer.scoreRun(cleanRunId);
gs.assertTrue(perfectScore.overall === 100, 'Run with no issues should score 100');
