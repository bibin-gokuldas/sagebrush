/**
 * SAGEBRUSH Go-Live Checklist
 * Run this Fix Script before production go-live to verify all required
 * configuration is in place. Read output in System Log.
 * Safe to re-run — makes no changes.
 */
(function runGoLiveChecklist() {
    var log = new GSLog('x_snc_sagebrush.golive', 'SAGEBRUSH_GoLiveChecklist');
    var passed = 0;
    var failed = 0;

    function check(label, condition, detail) {
        if (condition) {
            log.info('PASS: ' + label + (detail ? ' — ' + detail : ''));
            passed++;
        } else {
            log.warn('FAIL: ' + label + (detail ? ' — ' + detail : ''));
            failed++;
        }
    }

    // ── System Properties ────────────────────────────────────────────────────
    check('AI provider set',
        gs.getProperty('x_snc_sagebrush.ai.provider', '').length > 0,
        gs.getProperty('x_snc_sagebrush.ai.provider', '(not set)'));

    check('send_record_data is false',
        gs.getProperty('x_snc_sagebrush.ai.external.send_record_data', 'true') === 'false',
        'CRITICAL: raw records must never leave the instance');

    var aiKey = gs.getProperty('x_snc_sagebrush.ai.claude.api_key', '');
    var oaiKey = gs.getProperty('x_snc_sagebrush.ai.openai.api_key', '');
    check('At least one external AI key configured (claude or openai)',
        aiKey.length > 0 || oaiKey.length > 0);

    check('Greeting text configured',
        gs.getProperty('x_snc_sagebrush.greeting.text', '').length > 10);

    check('Dialogflow webhook secret configured',
        gs.getProperty('x_snc_sagebrush.dialogflow.webhook_secret', '').length > 8,
        'Must be > 8 chars; used to authenticate Dialogflow calls');

    // ── Tables exist ─────────────────────────────────────────────────────────
    var tables = [
        'x_snc_sagebrush_session', 'x_snc_sagebrush_audit_log', 'x_snc_sagebrush_ai_log',
        'x_snc_sagebrush_requirement', 'x_snc_sagebrush_instance_snapshot',
        'x_snc_sagebrush_oob_capability', 'x_snc_sagebrush_oob_map',
        'x_snc_sagebrush_dq_check', 'x_snc_sagebrush_dq_run', 'x_snc_sagebrush_dq_result'
    ];
    for (var i = 0; i < tables.length; i++) {
        var t = tables[i];
        check('Table exists: ' + t, GlideDBObjectManager.getInstance().isTableExist(t));
    }

    // ── DQ Checks seeded ─────────────────────────────────────────────────────
    var dqCount = new GlideAggregate('x_snc_sagebrush_dq_check');
    dqCount.addAggregate('COUNT');
    dqCount.query();
    dqCount.next();
    var checkCount = parseInt(dqCount.getAggregate('COUNT'), 10);
    check('DQ checks seeded (expect 28)', checkCount >= 28, checkCount + ' checks found');

    // ── OOB Capabilities seeded ──────────────────────────────────────────────
    var capCount = new GlideAggregate('x_snc_sagebrush_oob_capability');
    capCount.addAggregate('COUNT');
    capCount.query();
    capCount.next();
    var capTotal = parseInt(capCount.getAggregate('COUNT'), 10);
    check('OOB capabilities seeded', capTotal > 0, capTotal + ' capabilities found');

    // ── Roles exist ──────────────────────────────────────────────────────────
    var roles = ['x_snc_sagebrush.user', 'x_snc_sagebrush.admin', 'x_snc_sagebrush.architect'];
    for (var r = 0; r < roles.length; r++) {
        var roleGr = new GlideRecord('sys_user_role');
        roleGr.addQuery('name', roles[r]);
        roleGr.setLimit(1);
        roleGr.query();
        check('Role exists: ' + roles[r], roleGr.next());
    }

    // ── Script Includes accessible ───────────────────────────────────────────
    var sis = [
        'SAGEBRUSHAIProvider', 'SAGEBRUSHConversationHandler', 'SAGEBRUSHDataMasker',
        'SAGEBRUSHSessionManager', 'SAGEBRUSHDQEngine', 'SAGEBRUSHDialogflowHandler'
    ];
    for (var s = 0; s < sis.length; s++) {
        var siGr = new GlideRecord('sys_script_include');
        siGr.addQuery('name', sis[s]);
        siGr.addQuery('active', true);
        siGr.setLimit(1);
        siGr.query();
        check('Script Include active: ' + sis[s], siGr.next());
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    log.info('═══════════════════════════════════════════════════');
    log.info('SAGEBRUSH Go-Live Checklist: ' + passed + ' passed, ' + failed + ' failed');
    if (failed === 0) {
        log.info('ALL CHECKS PASSED — SAGEBRUSH is ready for production.');
    } else {
        log.warn('RESOLVE ' + failed + ' FAILURES before go-live.');
    }
    log.info('═══════════════════════════════════════════════════');
})();
