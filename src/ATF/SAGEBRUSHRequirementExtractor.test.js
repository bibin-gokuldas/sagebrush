// ATF Test: SAGEBRUSHRequirementExtractor

// Test 1: extractFromText creates requirement records
var extractor = new SAGEBRUSHRequirementExtractor();
var mgr = new SAGEBRUSHSessionManager();
var sessionId = mgr.createSession(gs.getUserID(), 'nowassist');

var sampleText = 'We need to automatically route incidents based on CI in CMDB and send Teams notifications to the assignment group when a P1 is raised.';
var requirements = extractor.extractFromText(sessionId, sampleText, 'chat');

gs.assertTrue(requirements !== null, 'extractFromText should return results');
gs.assertTrue(requirements.length > 0, 'Should extract at least one requirement');
gs.assertTrue(typeof requirements[0].sys_id === 'string', 'Each requirement should have a sys_id');
gs.assertTrue(typeof requirements[0].requirement_text === 'string', 'Each requirement should have text');

// Test 2: buildPlayback returns numbered string
var playback = extractor.buildPlayback(sessionId);
gs.assertTrue(typeof playback === 'string', 'buildPlayback should return string');
gs.assertTrue(playback.length > 0, 'playback should not be empty');
gs.assertTrue(playback.indexOf('1.') !== -1 || playback.indexOf('1)') !== -1, 'playback should be numbered');

// Test 3: confirmRequirement marks confirmed = true
var req = new GlideRecord('x_sagebrush_requirement');
req.addQuery('session', sessionId);
req.setLimit(1);
req.query();
gs.assertTrue(req.next(), 'should have at least one requirement record to confirm');
var reqSysId = req.getValue('sys_id');

var confirmed = extractor.confirmRequirement(reqSysId);
gs.assertTrue(confirmed === true, 'confirmRequirement should return true');

var updatedReq = new GlideRecord('x_sagebrush_requirement');
updatedReq.get(reqSysId);
gs.assertTrue(updatedReq.getValue('confirmed') === '1', 'confirmed field should be true');

// Cleanup
mgr.closeSession(sessionId);
