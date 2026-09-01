/**
 * @name SAGEBRUSHDQRemediator
 * @callable_from_other_scopes true
 * @access public
 * @scope x_sagebrush
 */
var SAGEBRUSHDQRemediator = Class.create();
SAGEBRUSHDQRemediator.prototype = {

    RESULT_TABLE: 'x_sagebrush_dq_result',

    DOMAIN_GROUPS: {
        'itsm':         'Service Desk',
        'itom':         'CMDB Team',
        'grc':          'Risk and Compliance',
        'bcm':          'Business Continuity Team',
        'csm':          'Customer Service Operations',
        'hrsd':         'HR Operations',
        'foundational': 'Platform Administration'
    },

    initialize: function(dependencies) {
        this.log   = new GSLog('x_sagebrush.dq.remediation', 'SAGEBRUSHDQRemediator');
        this.ai    = (dependencies && dependencies.ai)    || new SAGEBRUSHAIProvider();
        this.roles = (dependencies && dependencies.roles) || new SAGEBRUSHRoleHelper();
    },

    /**
     * Generates role-appropriate remediation hint for a DQ result.
     * Architect/Dev: technical detail. Admin: step-by-step. Viewer: plain language.
     * @param {string} resultSysId - x_sagebrush_dq_result sys_id
     * @param {string} userId
     * @returns {string}
     */
    getHint: function(resultSysId, userId) {
        var userRole = this.roles.getUserRole(userId);
        var result   = new GlideRecord(this.RESULT_TABLE);
        if (!result.get(resultSysId)) { return 'Result not found.'; }

        var message   = result.getValue('result_message') || '';
        var table     = result.getValue('table_name')     || '';
        var dimension = result.getValue('dimension')      || '';
        var domain    = result.getValue('domain')         || '';

        // Try to get AI-generated hint first (it may have been set at scan time)
        var existingHint = result.getValue('remediation_hint') || '';
        if (existingHint.length > 10) { return this._formatHintForRole(existingHint, userRole); }

        // Generate hint via AI
        var prompt = 'You are a ServiceNow ' + (userRole === 'architect' ? 'developer' : 'admin') + '. ' +
            'Provide a concise remediation hint for this data quality issue. ' +
            'Issue: ' + message + '. Table: ' + table + '. Dimension: ' + dimension + '. Domain: ' + domain + '. ' +
            (userRole === 'architect' ? 'Include GlideRecord query example and fix script.' : 'Use plain language step-by-step instructions.');

        var aiResult = this.ai.ask(prompt, {}, domain);
        var hint = aiResult.success ? aiResult.text : 'Please review and update the record to resolve this data quality issue.';

        // Cache hint on result record
        result.setValue('remediation_hint', hint);
        result.update();

        return this._formatHintForRole(hint, userRole);
    },

    _formatHintForRole: function(hint, role) {
        if (role === 'architect') { return hint; }
        if (role === 'admin')     { return hint; }
        // Viewer — truncate technical details
        var lines = hint.split('\n');
        return lines.slice(0, 3).join('\n');
    },

    type: 'SAGEBRUSHDQRemediator'
};
