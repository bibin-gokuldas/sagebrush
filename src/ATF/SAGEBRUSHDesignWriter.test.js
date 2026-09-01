// ATF Test: SAGEBRUSHDesignWriter
var writer    = new SAGEBRUSHDesignWriter();
var extractor = new SAGEBRUSHRequirementExtractor();
var mgr       = new SAGEBRUSHSessionManager();
var sessionId = mgr.createSession(gs.getUserID(), 'nowassist');

// Seed requirements and confirm them
extractor.extractFromText(sessionId, 'We need to automatically route incidents based on CI type and notify the assignment group via Teams when a P1 is raised.', 'chat');
extractor.confirmAll(sessionId);

// Test 1: generateHLD returns a bare String sys_id
var hldSysId = writer.generateHLD(sessionId);
gs.assertTrue(typeof hldSysId === 'string' && hldSysId.length > 0, 'generateHLD should return a non-empty string sys_id');

// Verify the KB article exists and has substantial content
var kb = new GlideRecord('kb_knowledge');
gs.assertTrue(kb.get(hldSysId), 'HLD KB article should exist in kb_knowledge');
gs.assertTrue(kb.getValue('text').length > 100, 'HLD content should be substantial');

// Verify the session hld_article field is populated
var sessionAfterHLD = mgr.getSession(sessionId);
gs.assertTrue(sessionAfterHLD.hld_article === hldSysId, 'hld_article on session should match the returned sys_id');

// Test 2: generateLLD returns a bare String sys_id (requires hldSysId)
var lldSysId = writer.generateLLD(sessionId, hldSysId);
gs.assertTrue(typeof lldSysId === 'string' && lldSysId.length > 0, 'generateLLD should return a non-empty string sys_id');

// Verify the LLD KB article exists and has substantial content
var lldKb = new GlideRecord('kb_knowledge');
gs.assertTrue(lldKb.get(lldSysId), 'LLD KB article should exist in kb_knowledge');
gs.assertTrue(lldKb.getValue('text').length > 100, 'LLD content should be substantial');

// Verify the session lld_article field is populated
var sessionAfterLLD = mgr.getSession(sessionId);
gs.assertTrue(sessionAfterLLD.lld_article === lldSysId, 'lld_article on session should match the returned sys_id');

// Test 3: generateLLD still works when called with a null/missing hldSysId (uses fallback)
var session2Id = mgr.createSession(gs.getUserID(), 'nowassist');
extractor.extractFromText(session2Id, 'Need a CMDB discovery dashboard.', 'chat');
extractor.confirmAll(session2Id);

var lldNoHLD = writer.generateLLD(session2Id, null);
gs.assertTrue(typeof lldNoHLD === 'string' && lldNoHLD.length > 0, 'generateLLD with null hldSysId should still return a valid sys_id via fallback');

// Cleanup
mgr.closeSession(sessionId);
mgr.closeSession(session2Id);
