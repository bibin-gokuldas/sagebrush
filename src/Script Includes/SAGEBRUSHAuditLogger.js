/**
 * @name SAGEBRUSHAuditLogger
 * @callable_from_other_scopes true
 * @access public
 * @scope x_sagebrush
 */
var SAGEBRUSHAuditLogger = Class.create();
SAGEBRUSHAuditLogger.prototype = {

    VALID_EVENTS: ['invoked', 'ai_call', 'instance_scan', 'dq_scan', 'design_generated', 'cross_scope_read'],

    initialize: function() {
        this.gslog = new GSLog('x_sagebrush.audit', 'SAGEBRUSHAuditLogger');
    },

    /**
     * Appends an audit record. Never throws — audit failure must not break agent flow.
     * @param {string} eventType - One of VALID_EVENTS
     * @param {string} detail - Human-readable description
     * @param {Object} options - { sessionSysId, tableName, recordCount }
     */
    log: function(eventType, detail, options) {
        try {
            if (this.VALID_EVENTS.indexOf(eventType) === -1) {
                this.gslog.warn('SAGEBRUSHAuditLogger: unknown eventType [' + eventType + '], skipping audit write');
                return;
            }
            var opts = options || {};
            var audit = new GlideRecord('x_sagebrush_audit');
            audit.initialize();
            audit.setValue('user_sys_id', gs.getUserID());
            audit.setValue('event_type', eventType);
            audit.setValue('detail', detail || '');
            if (opts.sessionSysId) { audit.setValue('session', opts.sessionSysId); }
            if (opts.tableName)    { audit.setValue('table_name', opts.tableName); }
            if (opts.recordCount)  { audit.setValue('record_count', opts.recordCount); }
            var insertResult = audit.insert();
            if (!insertResult) {
                this.gslog.warn('Audit insert returned null for eventType: ' + eventType);
            }
        } catch (e) {
            this.gslog.warn('Audit log write failed (non-fatal): ' + e.message);
        }
    },

    type: 'SAGEBRUSHAuditLogger'
};
