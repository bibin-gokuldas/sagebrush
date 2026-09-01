/**
 * SAGEBRUSH — Create Tables
 * Run in: Scripts - Background (as admin, in global scope)
 *
 * Creates all 10 SAGEBRUSH tables with their fields and choice values.
 * Safe to re-run — skips tables and fields that already exist.
 */
(function createSAGEBRUSHTables() {

    var SCOPE_SYS_ID = '37abe07193074f10fb3a39018bba1060';

    // Look up task table sys_id (needed for session extends task)
    var taskTableGr = new GlideRecord('sys_db_object');
    taskTableGr.addQuery('name', 'task');
    taskTableGr.setLimit(1);
    taskTableGr.query();
    var taskSysId = taskTableGr.next() ? taskTableGr.getUniqueValue() : '';

    var created = 0;
    var skipped = 0;

    // ─── Helper: create table ────────────────────────────────────────────────
    function createTable(name, label, extendsSysId) {
        var existing = new GlideRecord('sys_db_object');
        existing.addQuery('name', name);
        existing.setLimit(1);
        existing.query();
        if (existing.next()) {
            gs.print('Table already exists: ' + name);
            skipped++;
            return existing.getUniqueValue();
        }
        var gr = new GlideRecord('sys_db_object');
        gr.initialize();
        gr.setValue('name',       name);
        gr.setValue('label',      label);
        gr.setValue('sys_scope',  SCOPE_SYS_ID);
        if (extendsSysId) { gr.setValue('super_class', extendsSysId); }
        var sysId = gr.insert();
        gs.print('Created table: ' + name + ' (' + sysId + ')');
        created++;
        return sysId;
    }

    // ─── Helper: create field ────────────────────────────────────────────────
    function createField(tableName, element, label, type, opts) {
        opts = opts || {};
        var existing = new GlideRecord('sys_dictionary');
        existing.addQuery('name',    tableName);
        existing.addQuery('element', element);
        existing.setLimit(1);
        existing.query();
        if (existing.next()) { return; } // already exists

        var gr = new GlideRecord('sys_dictionary');
        gr.initialize();
        gr.setValue('name',          tableName);
        gr.setValue('element',       element);
        gr.setValue('column_label',  label);
        gr.setValue('internal_type', type);
        gr.setValue('sys_scope',     SCOPE_SYS_ID);
        if (opts.maxLength)  { gr.setValue('max_length',  opts.maxLength); }
        if (opts.mandatory)  { gr.setValue('mandatory',   true); }
        if (opts.reference)  { gr.setValue('reference',   opts.reference); }
        if (opts.defaultVal !== undefined) { gr.setValue('default_value', opts.defaultVal); }
        gr.insert();
    }

    // ─── Helper: create choice values ────────────────────────────────────────
    function createChoices(tableName, element, choices) {
        for (var i = 0; i < choices.length; i++) {
            var val = choices[i];
            var existing = new GlideRecord('sys_choice');
            existing.addQuery('name',    tableName);
            existing.addQuery('element', element);
            existing.addQuery('value',   val);
            existing.setLimit(1);
            existing.query();
            if (existing.next()) { continue; }
            var gr = new GlideRecord('sys_choice');
            gr.initialize();
            gr.setValue('name',      tableName);
            gr.setValue('element',   element);
            gr.setValue('value',     val);
            gr.setValue('label',     val.charAt(0).toUpperCase() + val.slice(1).replace(/_/g, ' '));
            gr.setValue('sequence',  i * 100);
            gr.setValue('sys_scope', SCOPE_SYS_ID);
            gr.insert();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 1. x_snc_sagebrush_session (extends task)
    // ═══════════════════════════════════════════════════════════════════════
    createTable('x_snc_sagebrush_session', 'SAGEBRUSH Session', taskSysId);
    createField('x_snc_sagebrush_session', 'user_sys_id', 'User',            'reference', { ref_table: 'sys_user',      mandatory: true, reference: 'sys_user' });
    createField('x_snc_sagebrush_session', 'channel',     'Channel',         'string',    { maxLength: 40, mandatory: true });
    createField('x_snc_sagebrush_session', 'state',       'State',           'string',    { maxLength: 40, defaultVal: 'active' });
    createField('x_snc_sagebrush_session', 'intent',      'Current Intent',  'string',    { maxLength: 40, defaultVal: 'none' });
    createField('x_snc_sagebrush_session', 'hld_article', 'HLD Article',     'reference', { reference: 'kb_knowledge' });
    createField('x_snc_sagebrush_session', 'lld_article', 'LLD Article',     'reference', { reference: 'kb_knowledge' });
    createField('x_snc_sagebrush_session', 'context_json','Context JSON',    'string',    { maxLength: 65536 });
    createChoices('x_snc_sagebrush_session', 'channel', ['nowassist','virtualagent','phone']);
    createChoices('x_snc_sagebrush_session', 'state',   ['active','idle','closed']);
    createChoices('x_snc_sagebrush_session', 'intent',  ['none','solution_design','data_quality']);
    gs.print('Session table fields done.');

    // ═══════════════════════════════════════════════════════════════════════
    // 2. x_snc_sagebrush_audit
    // ═══════════════════════════════════════════════════════════════════════
    createTable('x_snc_sagebrush_audit', 'SAGEBRUSH Audit Log', '');
    createField('x_snc_sagebrush_audit', 'session',      'Session',    'reference', { reference: 'x_snc_sagebrush_session' });
    createField('x_snc_sagebrush_audit', 'user_sys_id',  'User',       'reference', { reference: 'sys_user', mandatory: true });
    createField('x_snc_sagebrush_audit', 'event_type',   'Event Type', 'string',    { maxLength: 80, mandatory: true });
    createField('x_snc_sagebrush_audit', 'detail',       'Detail',     'string',    { maxLength: 4096 });
    createField('x_snc_sagebrush_audit', 'table_name',   'Table',      'string',    { maxLength: 80 });
    createField('x_snc_sagebrush_audit', 'record_count', 'Record Count','integer',  {});
    createChoices('x_snc_sagebrush_audit', 'event_type', ['invoked','ai_call','instance_scan','dq_scan','design_generated','cross_scope_read']);
    gs.print('Audit table fields done.');

    // ═══════════════════════════════════════════════════════════════════════
    // 3. x_snc_sagebrush_ai_log
    // ═══════════════════════════════════════════════════════════════════════
    createTable('x_snc_sagebrush_ai_log', 'SAGEBRUSH AI Log', '');
    createField('x_snc_sagebrush_ai_log', 'session',       'Session',         'reference', { reference: 'x_snc_sagebrush_session' });
    createField('x_snc_sagebrush_ai_log', 'provider',      'Provider Used',   'string',    { maxLength: 40, mandatory: true });
    createField('x_snc_sagebrush_ai_log', 'domain',        'Domain',          'string',    { maxLength: 80 });
    createField('x_snc_sagebrush_ai_log', 'fallback_used', 'Fallback Triggered','boolean', { defaultVal: 'false' });
    createField('x_snc_sagebrush_ai_log', 'token_count',   'Token Count',     'integer',   {});
    createField('x_snc_sagebrush_ai_log', 'response_ms',   'Response Time (ms)','integer', {});
    createField('x_snc_sagebrush_ai_log', 'success',       'Success',         'boolean',   { mandatory: true });
    createField('x_snc_sagebrush_ai_log', 'error_message', 'Error',           'string',    { maxLength: 1024 });
    createField('x_snc_sagebrush_ai_log', 'prompt_hash',   'Prompt Hash',     'string',    { maxLength: 64 });
    createChoices('x_snc_sagebrush_ai_log', 'provider', ['nowassist','claude','openai']);
    gs.print('AI Log table fields done.');

    // ═══════════════════════════════════════════════════════════════════════
    // 4. x_snc_sagebrush_requirement
    // ═══════════════════════════════════════════════════════════════════════
    createTable('x_snc_sagebrush_requirement', 'SAGEBRUSH Requirement', '');
    createField('x_snc_sagebrush_requirement', 'session',          'Session',          'reference', { reference: 'x_snc_sagebrush_session', mandatory: true });
    createField('x_snc_sagebrush_requirement', 'requirement_text', 'Requirement Text', 'string',    { maxLength: 4096, mandatory: true });
    createField('x_snc_sagebrush_requirement', 'requirement_type', 'Type',             'string',    { maxLength: 40 });
    createField('x_snc_sagebrush_requirement', 'priority',         'Priority',         'string',    { maxLength: 20, defaultVal: 'medium' });
    createField('x_snc_sagebrush_requirement', 'source',           'Source',           'string',    { maxLength: 40 });
    createField('x_snc_sagebrush_requirement', 'confirmed',        'User Confirmed',   'boolean',   { defaultVal: 'false' });
    createField('x_snc_sagebrush_requirement', 'oob_mapping',      'OOB Mapping',      'reference', { reference: 'x_snc_sagebrush_oob_map' });
    createField('x_snc_sagebrush_requirement', 'sequence',         'Sequence Number',  'integer',   {});
    createChoices('x_snc_sagebrush_requirement', 'requirement_type', ['functional','non_functional','integration','constraint']);
    createChoices('x_snc_sagebrush_requirement', 'priority',         ['high','medium','low']);
    createChoices('x_snc_sagebrush_requirement', 'source',           ['voice','chat','document']);
    gs.print('Requirement table fields done.');

    // ═══════════════════════════════════════════════════════════════════════
    // 5. x_snc_sagebrush_instance_snapshot
    // ═══════════════════════════════════════════════════════════════════════
    createTable('x_snc_sagebrush_instance_snapshot', 'SAGEBRUSH Instance Snapshot', '');
    createField('x_snc_sagebrush_instance_snapshot', 'session',         'Session',          'reference', { reference: 'x_snc_sagebrush_session' });
    createField('x_snc_sagebrush_instance_snapshot', 'snapshot_json',   'Snapshot JSON',    'string',    { maxLength: 1048576 });
    createField('x_snc_sagebrush_instance_snapshot', 'domains_scanned', 'Domains Scanned',  'string',    { maxLength: 512 });
    createField('x_snc_sagebrush_instance_snapshot', 'plugin_count',    'Active Plugins',   'integer',   {});
    createField('x_snc_sagebrush_instance_snapshot', 'app_count',       'Custom Apps',      'integer',   {});
    createField('x_snc_sagebrush_instance_snapshot', 'scan_duration_ms','Scan Duration (ms)','integer',  {});
    gs.print('Instance Snapshot table fields done.');

    // ═══════════════════════════════════════════════════════════════════════
    // 6. x_snc_sagebrush_oob_capability
    // ═══════════════════════════════════════════════════════════════════════
    createTable('x_snc_sagebrush_oob_capability', 'SAGEBRUSH OOB Capability', '');
    createField('x_snc_sagebrush_oob_capability', 'capability_name', 'Capability Name',  'string',  { maxLength: 255, mandatory: true });
    createField('x_snc_sagebrush_oob_capability', 'module',          'ServiceNow Module','string',  { maxLength: 100, mandatory: true });
    createField('x_snc_sagebrush_oob_capability', 'description',     'Description',      'string',  { maxLength: 2048 });
    createField('x_snc_sagebrush_oob_capability', 'priority_level',  'Priority Level',   'integer', { mandatory: true });
    createField('x_snc_sagebrush_oob_capability', 'plugin_id',       'Required Plugin ID','string', { maxLength: 255 });
    createField('x_snc_sagebrush_oob_capability', 'license_tier',    'License Tier',     'string',  { maxLength: 40 });
    createField('x_snc_sagebrush_oob_capability', 'tables_involved', 'Tables',           'string',  { maxLength: 1024 });
    createField('x_snc_sagebrush_oob_capability', 'keywords',        'Keywords',         'string',  { maxLength: 2048 });
    createField('x_snc_sagebrush_oob_capability', 'domain',          'Domain',           'string',  { maxLength: 40 });
    createField('x_snc_sagebrush_oob_capability', 'active',          'Active',           'boolean', { defaultVal: 'true' });
    createChoices('x_snc_sagebrush_oob_capability', 'license_tier', ['standard','pro','enterprise','store','free']);
    createChoices('x_snc_sagebrush_oob_capability', 'domain',       ['itsm','itom','grc','bcm','csm','hrsd','platform','custom']);
    gs.print('OOB Capability table fields done.');

    // ═══════════════════════════════════════════════════════════════════════
    // 7. x_snc_sagebrush_oob_map
    // ═══════════════════════════════════════════════════════════════════════
    createTable('x_snc_sagebrush_oob_map', 'SAGEBRUSH OOB Mapping', '');
    createField('x_snc_sagebrush_oob_map', 'session',      'Session',            'reference', { reference: 'x_snc_sagebrush_session' });
    createField('x_snc_sagebrush_oob_map', 'requirement',  'Requirement',        'reference', { reference: 'x_snc_sagebrush_requirement' });
    createField('x_snc_sagebrush_oob_map', 'capability',   'OOB Capability',     'reference', { reference: 'x_snc_sagebrush_oob_capability' });
    createField('x_snc_sagebrush_oob_map', 'match_score',  'Match Score (0-100)','integer',   {});
    createField('x_snc_sagebrush_oob_map', 'config_needed','Configuration Required','string', { maxLength: 2048 });
    createField('x_snc_sagebrush_oob_map', 'custom_code',  'Custom Code Required','boolean',  { defaultVal: 'false' });
    createField('x_snc_sagebrush_oob_map', 'risk_level',   'Risk',               'string',    { maxLength: 20 });
    createField('x_snc_sagebrush_oob_map', 'ai_rationale', 'AI Rationale',       'string',    { maxLength: 4096 });
    createChoices('x_snc_sagebrush_oob_map', 'risk_level', ['low','medium','high']);
    gs.print('OOB Map table fields done.');

    // ═══════════════════════════════════════════════════════════════════════
    // 8. x_snc_sagebrush_dq_check
    // ═══════════════════════════════════════════════════════════════════════
    createTable('x_snc_sagebrush_dq_check', 'SAGEBRUSH DQ Check', '');
    createField('x_snc_sagebrush_dq_check', 'check_name',      'Check Name',     'string',  { maxLength: 255, mandatory: true });
    createField('x_snc_sagebrush_dq_check', 'domain',          'Domain',         'string',  { maxLength: 40, mandatory: true });
    createField('x_snc_sagebrush_dq_check', 'dimension',       'Dimension',      'string',  { maxLength: 40, mandatory: true });
    createField('x_snc_sagebrush_dq_check', 'target_table',    'Target Table',   'string',  { maxLength: 80, mandatory: true });
    createField('x_snc_sagebrush_dq_check', 'check_query',     'GlideRecord Query','string',{ maxLength: 4096 });
    createField('x_snc_sagebrush_dq_check', 'check_script',    'Check Script',   'string',  { maxLength: 8192 });
    createField('x_snc_sagebrush_dq_check', 'severity',        'Severity',       'string',  { maxLength: 20, mandatory: true });
    createField('x_snc_sagebrush_dq_check', 'message_template','Message Template','string', { maxLength: 1024 });
    createField('x_snc_sagebrush_dq_check', 'active',          'Active',         'boolean', { defaultVal: 'true' });
    createField('x_snc_sagebrush_dq_check', 'check_type',      'Check Type',     'string',  { maxLength: 20, defaultVal: 'query' });
    createChoices('x_snc_sagebrush_dq_check', 'domain',     ['itsm','itom','grc','bcm','csm','hrsd','foundational']);
    createChoices('x_snc_sagebrush_dq_check', 'dimension',  ['completeness','accuracy','consistency','referential','staleness','duplicate','compliance']);
    createChoices('x_snc_sagebrush_dq_check', 'severity',   ['critical','high','medium','low']);
    createChoices('x_snc_sagebrush_dq_check', 'check_type', ['query','script']);
    gs.print('DQ Check table fields done.');

    // ═══════════════════════════════════════════════════════════════════════
    // 9. x_snc_sagebrush_dq_run
    // ═══════════════════════════════════════════════════════════════════════
    createTable('x_snc_sagebrush_dq_run', 'SAGEBRUSH DQ Run', '');
    createField('x_snc_sagebrush_dq_run', 'run_type',      'Run Type',       'string',  { maxLength: 20, mandatory: true });
    createField('x_snc_sagebrush_dq_run', 'domain',        'Domain',         'string',  { maxLength: 40 });
    createField('x_snc_sagebrush_dq_run', 'target_table',  'Target Table',   'string',  { maxLength: 80 });
    createField('x_snc_sagebrush_dq_run', 'triggered_by',  'Triggered By',   'string',  { maxLength: 40 });
    createField('x_snc_sagebrush_dq_run', 'session',       'Session',        'reference',{ reference: 'x_snc_sagebrush_session' });
    createField('x_snc_sagebrush_dq_run', 'state',         'State',          'string',  { maxLength: 20, defaultVal: 'running' });
    createField('x_snc_sagebrush_dq_run', 'checks_run',    'Checks Run',     'integer', {});
    createField('x_snc_sagebrush_dq_run', 'issues_found',  'Issues Found',   'integer', {});
    createField('x_snc_sagebrush_dq_run', 'critical_count','Critical Issues','integer', {});
    createField('x_snc_sagebrush_dq_run', 'high_count',    'High Issues',    'integer', {});
    createField('x_snc_sagebrush_dq_run', 'medium_count',  'Medium Issues',  'integer', {});
    createField('x_snc_sagebrush_dq_run', 'low_count',     'Low Issues',     'integer', {});
    createField('x_snc_sagebrush_dq_run', 'duration_ms',   'Duration (ms)',  'integer', {});
    createField('x_snc_sagebrush_dq_run', 'dq_score',      'DQ Score',       'decimal', {});
    createChoices('x_snc_sagebrush_dq_run', 'run_type',     ['full','domain','targeted']);
    createChoices('x_snc_sagebrush_dq_run', 'triggered_by', ['scheduled','conversation','manual']);
    createChoices('x_snc_sagebrush_dq_run', 'state',        ['running','complete','failed']);
    gs.print('DQ Run table fields done.');

    // ═══════════════════════════════════════════════════════════════════════
    // 10. x_snc_sagebrush_dq_result
    // ═══════════════════════════════════════════════════════════════════════
    createTable('x_snc_sagebrush_dq_result', 'SAGEBRUSH DQ Result', '');
    createField('x_snc_sagebrush_dq_result', 'dq_run',          'DQ Run',          'reference', { reference: 'x_snc_sagebrush_dq_run',   mandatory: true });
    createField('x_snc_sagebrush_dq_result', 'dq_check',        'DQ Check',        'reference', { reference: 'x_snc_sagebrush_dq_check', mandatory: true });
    createField('x_snc_sagebrush_dq_result', 'domain',          'Domain',          'string',    { maxLength: 40 });
    createField('x_snc_sagebrush_dq_result', 'dimension',       'Dimension',       'string',    { maxLength: 40 });
    createField('x_snc_sagebrush_dq_result', 'severity',        'Severity',        'string',    { maxLength: 20 });
    createField('x_snc_sagebrush_dq_result', 'table_name',      'Table',           'string',    { maxLength: 80 });
    createField('x_snc_sagebrush_dq_result', 'record_sys_id',   'Record Sys ID',   'string',    { maxLength: 32 });
    createField('x_snc_sagebrush_dq_result', 'result_message',  'Result Message',  'string',    { maxLength: 2048 });
    createField('x_snc_sagebrush_dq_result', 'detected_by',     'Detected By',     'string',    { maxLength: 20 });
    createField('x_snc_sagebrush_dq_result', 'status',          'Status',          'string',    { maxLength: 20, defaultVal: 'open' });
    createField('x_snc_sagebrush_dq_result', 'assigned_to',     'Assigned Group',  'reference', { reference: 'sys_user_group' });
    createField('x_snc_sagebrush_dq_result', 'remediation_hint','Remediation Hint','string',    { maxLength: 4096 });
    createChoices('x_snc_sagebrush_dq_result', 'domain',      ['itsm','itom','grc','bcm','csm','hrsd','foundational']);
    createChoices('x_snc_sagebrush_dq_result', 'dimension',   ['completeness','accuracy','consistency','referential','staleness','duplicate','compliance']);
    createChoices('x_snc_sagebrush_dq_result', 'severity',    ['critical','high','medium','low']);
    createChoices('x_snc_sagebrush_dq_result', 'detected_by', ['rule','ai']);
    createChoices('x_snc_sagebrush_dq_result', 'status',      ['open','acknowledged','remediated','suppressed']);
    gs.print('DQ Result table fields done.');

    // ─── Summary ─────────────────────────────────────────────────────────────
    gs.print('');
    gs.print('==============================================');
    gs.print('SAGEBRUSH Tables: ' + created + ' created, ' + skipped + ' already existed');
    gs.print('Run SAGEBRUSH_Install.js next, then SeedOOBCapabilities, then SeedDQChecks');
    gs.print('==============================================');

})();
