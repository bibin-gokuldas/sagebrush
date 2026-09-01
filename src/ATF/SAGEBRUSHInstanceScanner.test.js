// ATF Test: SAGEBRUSHInstanceScanner
var scanner = new SAGEBRUSHInstanceScanner();
var mgr     = new SAGEBRUSHSessionManager();
var sessionId = mgr.createSession(gs.getUserID(), 'nowassist');

// Test 1: scan returns a snapshot sys_id
var snapshotId = scanner.scan(sessionId);
gs.assertTrue(snapshotId !== null, 'scan should return snapshot sys_id');
gs.assertTrue(snapshotId.length === 32, 'snapshot sys_id should be 32 chars');

// Test 2: getSnapshot returns structured data
var snapshot = scanner.getSnapshot(sessionId);
gs.assertTrue(snapshot !== null, 'getSnapshot should return data');
gs.assertTrue(typeof snapshot === 'object', 'snapshot should be an object');
gs.assertTrue(snapshot.hasOwnProperty('plugins'), 'snapshot should have plugins key');
gs.assertTrue(snapshot.hasOwnProperty('scopes'), 'snapshot should have scopes key');
gs.assertTrue(snapshot.hasOwnProperty('itsm'), 'snapshot should have itsm key');
gs.assertTrue(snapshot.hasOwnProperty('itom'), 'snapshot should have itom key');
gs.assertTrue(snapshot.hasOwnProperty('grc'), 'snapshot should have grc key');
gs.assertTrue(snapshot.hasOwnProperty('bcm'), 'snapshot should have bcm key');
gs.assertTrue(snapshot.hasOwnProperty('csm'), 'snapshot should have csm key');
gs.assertTrue(snapshot.hasOwnProperty('hrsd'), 'snapshot should have hrsd key');
gs.assertTrue(snapshot.hasOwnProperty('integrations'), 'snapshot should have integrations key');
gs.assertTrue(snapshot.hasOwnProperty('nowassist'), 'snapshot should have nowassist key');
gs.assertTrue(Array.isArray(snapshot.plugins), 'plugins should be an array');

// Test 3: scan writes audit record
var audit = new GlideRecord('x_snc_sagebrush_audit');
audit.addQuery('session', sessionId);
audit.addQuery('event_type', 'instance_scan');
audit.query();
gs.assertTrue(audit.next(), 'instance_scan audit event should be written');

// Cleanup
mgr.closeSession(sessionId);
