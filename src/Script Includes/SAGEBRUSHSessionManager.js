/**
 * @name SAGEBRUSHSessionManager
 * @callable_from_other_scopes true
 * @access public
 * @scope x_sagebrush
 */
var SAGEBRUSHSessionManager = Class.create();
SAGEBRUSHSessionManager.prototype = {

    SESSION_TABLE: 'x_sagebrush_session',

    initialize: function() {
        this.log    = new GSLog('x_sagebrush.session', 'SAGEBRUSHSessionManager');
        this.auditor = new SAGEBRUSHAuditLogger();
    },

    /**
     * Creates a new SAGEBRUSH session for a user.
     * @param {string} userId - sys_user sys_id
     * @param {string} channel - nowassist | virtualagent | phone
     * @returns {string} sys_id of created session, or null on failure
     */
    createSession: function(userId, channel) {
        try {
            var session = new GlideRecord(this.SESSION_TABLE);
            session.initialize();
            session.setValue('user_sys_id', userId);
            session.setValue('channel', channel);
            session.setValue('state', 'active');
            session.setValue('intent', 'none');
            session.setValue('short_description', 'SAGEBRUSH Session - ' + new GlideDateTime().getDisplayValue());
            var sysId = session.insert();
            this.auditor.log('invoked', 'Session created via ' + channel, { sessionSysId: sysId });
            return sysId;
        } catch (e) {
            this.log.error('createSession failed: ' + e.message);
            return null;
        }
    },

    /**
     * Returns session data as a plain object.
     * @param {string} sessionSysId
     * @returns {Object|null} { sys_id, channel, state, intent, hld_article, lld_article, context_json }
     */
    getSession: function(sessionSysId) {
        try {
            var session = new GlideRecord(this.SESSION_TABLE);
            if (!session.get(sessionSysId)) { return null; }
            return {
                sys_id:       session.getValue('sys_id'),
                channel:      session.getValue('channel'),
                state:        session.getValue('state'),
                intent:       session.getValue('intent'),
                hld_article:  session.getValue('hld_article'),
                lld_article:  session.getValue('lld_article'),
                context_json: session.getValue('context_json')
            };
        } catch (e) {
            this.log.error('getSession failed: ' + e.message);
            return null;
        }
    },

    /**
     * Updates the intent on an active session.
     * @param {string} sessionSysId
     * @param {string} intent - none | solution_design | data_quality
     * @returns {Boolean}
     */
    updateIntent: function(sessionSysId, intent) {
        try {
            var session = new GlideRecord(this.SESSION_TABLE);
            if (!session.get(sessionSysId)) { return false; }
            session.setValue('intent', intent);
            var updateResult = session.update();
            return (updateResult !== null);
        } catch (e) {
            this.log.error('updateIntent failed: ' + e.message);
            return false;
        }
    },

    /**
     * Closes a session — sets state to closed.
     * @param {string} sessionSysId
     * @returns {Boolean}
     */
    closeSession: function(sessionSysId) {
        try {
            var session = new GlideRecord(this.SESSION_TABLE);
            if (!session.get(sessionSysId)) { return false; }
            session.setValue('state', 'closed');
            var updateResult = session.update();
            return (updateResult !== null);
        } catch (e) {
            this.log.error('closeSession failed: ' + e.message);
            return false;
        }
    },

    /**
     * Stores arbitrary context JSON on the session (for multi-turn conversation state).
     * @param {string} sessionSysId
     * @param {Object} contextObj
     * @returns {Boolean}
     */
    setContext: function(sessionSysId, contextObj) {
        try {
            var session = new GlideRecord(this.SESSION_TABLE);
            if (!session.get(sessionSysId)) { return false; }
            session.setValue('context_json', JSON.stringify(contextObj));
            var updateResult = session.update();
            return (updateResult !== null);
        } catch (e) {
            this.log.error('setContext failed: ' + e.message);
            return false;
        }
    },

    type: 'SAGEBRUSHSessionManager'
};
