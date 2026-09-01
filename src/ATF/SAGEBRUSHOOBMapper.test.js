// ATF Test: SAGEBRUSHOOBMapper
var mapper    = new SAGEBRUSHOOBMapper();
var extractor = new SAGEBRUSHRequirementExtractor();
var mgr       = new SAGEBRUSHSessionManager();
var sessionId = mgr.createSession(gs.getUserID(), 'nowassist');

// Seed one requirement
extractor.extractFromText(sessionId, 'We need to send Teams notifications when a P1 incident is raised', 'chat');
extractor.confirmAll(sessionId);

// Test 1: mapSession returns an array
var mappings = mapper.mapSession(sessionId, null);
gs.assertTrue(Array.isArray(mappings), 'mapSession should return an array');
gs.assertTrue(mappings.length > 0, 'Should produce at least one mapping');

// Test 2: each mapping has required fields
var m = mappings[0];
gs.assertTrue(m.hasOwnProperty('capability_name'), 'mapping should have capability_name');
gs.assertTrue(typeof m.match_score === 'number', 'match_score should be a number');
gs.assertTrue(m.match_score >= 0 && m.match_score <= 100, 'match_score should be 0-100');

// Test 3: buildMappingSummary returns string
var summary = mapper.buildMappingSummary(sessionId);
gs.assertTrue(typeof summary === 'string', 'buildMappingSummary should return string');
gs.assertTrue(summary.length > 0, 'summary should not be empty');

// Cleanup
mgr.closeSession(sessionId);
