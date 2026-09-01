/**
 * @name SAGEBRUSHDQRuleEngine
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHDQRuleEngine = Class.create();
SAGEBRUSHDQRuleEngine.prototype = {

    CHECK_TABLE:  'x_snc_sagebrush_dq_check',
    RESULT_TABLE: 'x_snc_sagebrush_dq_result',
    RUN_TABLE:    'x_snc_sagebrush_dq_run',
    CHUNK_SIZE:   500,

    SEVERITY_WEIGHTS: { critical: 10, high: 5, medium: 2, low: 1 },

    initialize: function() {
        this.log = new GSLog('x_snc_sagebrush.dq.rules', 'SAGEBRUSHDQRuleEngine');
    },

    /**
     * Runs all active checks for a specific domain.
     * @param {string} runSysId - x_snc_sagebrush_dq_run sys_id
     * @param {string} domain - itsm|itom|grc|bcm|csm|hrsd|foundational
     * @returns {Object} { checks_run, issues_found, results }
     */
    runDomain: function(runSysId, domain) {
        var checks = this._getActiveChecks(domain);
        if (checks.length === 0) {
            this.log.warn('No active checks found for domain: ' + domain);
            return { checks_run: 0, issues_found: 0, results: [] };
        }

        var totalIssues = 0;
        var allResults  = [];

        for (var i = 0; i < checks.length; i++) {
            try {
                var checkResults = this._executeCheck(checks[i], runSysId);
                totalIssues += checkResults.length;
                allResults   = allResults.concat(checkResults);
            } catch (e) {
                this.log.error('Check failed [' + checks[i].check_name + ']: ' + e.message);
            }
        }

        return { checks_run: checks.length, issues_found: totalIssues, results: allResults };
    },

    /**
     * Runs all active checks across all domains.
     * @param {string} runSysId
     * @returns {Object} { checks_run, issues_found }
     */
    runAll: function(runSysId) {
        var domains = ['foundational', 'itsm', 'itom', 'grc', 'bcm', 'csm', 'hrsd'];
        var totalChecks = 0;
        var totalIssues = 0;

        for (var i = 0; i < domains.length; i++) {
            var domainResult = this.runDomain(runSysId, domains[i]);
            totalChecks += domainResult.checks_run;
            totalIssues += domainResult.issues_found;
        }

        return { checks_run: totalChecks, issues_found: totalIssues };
    },

    _getActiveChecks: function(domain) {
        var checks = [];
        var gr = new GlideRecord(this.CHECK_TABLE);
        gr.addQuery('active', true);
        if (domain && domain !== 'all') { gr.addQuery('domain', domain); }
        gr.query();
        while (gr.next()) {
            checks.push({
                sys_id:           gr.getValue('sys_id'),
                check_name:       gr.getValue('check_name'),
                domain:           gr.getValue('domain'),
                dimension:        gr.getValue('dimension'),
                severity:         gr.getValue('severity'),
                target_table:     gr.getValue('target_table'),
                check_query:      gr.getValue('check_query'),
                check_script:     gr.getValue('check_script'),
                check_type:       gr.getValue('check_type'),
                message_template: gr.getValue('message_template')
            });
        }
        return checks;
    },

    _executeCheck: function(check, runSysId) {
        if (check.check_type === 'script' && check.check_script) {
            return this._executeScriptCheck(check, runSysId);
        }
        return this._executeQueryCheck(check, runSysId);
    },

    _executeQueryCheck: function(check, runSysId) {
        var results  = [];
        var offset   = 0;

        do {
            var gr = new GlideRecord(check.target_table);
            gr.addEncodedQuery(check.check_query);
            gr.chooseWindow(offset, offset + this.CHUNK_SIZE);
            gr.query();

            var chunkSize = 0;
            while (gr.next()) {
                chunkSize++;
                var sysId   = gr.getValue('sys_id');
                var message = this._renderMessage(check.message_template, gr);
                var resultId = this._saveResult(runSysId, check, check.target_table, sysId, message, 'rule');
                results.push({ sys_id: resultId, record: sysId, message: message });
            }

            offset += chunkSize;
            if (chunkSize < this.CHUNK_SIZE) { break; }
        } while (true);

        return results;
    },

    _executeScriptCheck: function(check) {
        // Script-type checks cannot be executed via eval in scoped apps — security risk.
        // Admin-authored check_script execution is not supported in this context.
        this.log.warn('Script check [' + check.check_name + '] skipped — eval not supported in scoped apps.');
        return [];
    },

    _saveResult: function(runSysId, check, tableName, recordSysId, message, detectedBy) {
        try {
            var gr = new GlideRecord(this.RESULT_TABLE);
            gr.initialize();
            gr.setValue('dq_run',        runSysId);
            gr.setValue('dq_check',      check.sys_id);
            gr.setValue('domain',        check.domain);
            gr.setValue('dimension',     check.dimension);
            gr.setValue('severity',      check.severity);
            gr.setValue('table_name',    tableName);
            gr.setValue('record_sys_id', recordSysId || '');
            gr.setValue('result_message', message);
            gr.setValue('detected_by',   detectedBy || 'rule');
            gr.setValue('status',        'open');
            return gr.insert();
        } catch (e) {
            this.log.warn('Failed to save DQ result: ' + e.message);
            return null;
        }
    },

    _renderMessage: function(template, gr) {
        if (!template) { return 'Issue found on ' + gr.getValue('sys_id'); }
        return template.replace('{record}', gr.getDisplayValue() || gr.getValue('sys_id'));
    },

    type: 'SAGEBRUSHDQRuleEngine'
};
