/**
 * @name SAGEBRUSHConversationHandler
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHConversationHandler = Class.create();
SAGEBRUSHConversationHandler.prototype = {

    SOLUTION_DESIGN_KEYWORDS: ['solution design', 'design', 'hld', 'lld', 'architecture', 'build', 'implement', 'requirement'],
    DATA_QUALITY_KEYWORDS:    ['data quality', 'dq', 'quality check', 'data check', 'check data', 'clean data', 'duplicate', 'missing data'],

    initialize: function(dependencies) {
        this.log     = new GSLog('x_snc_sagebrush.conversation', 'SAGEBRUSHConversationHandler');
        this.ai      = (dependencies && dependencies.ai)      || new SAGEBRUSHAIProvider();
        this.session = (dependencies && dependencies.session) || new SAGEBRUSHSessionManager();
        this.auditor = (dependencies && dependencies.auditor) || new SAGEBRUSHAuditLogger();
        this.roles   = (dependencies && dependencies.roles)   || new SAGEBRUSHRoleHelper();
    },

    /**
     * Called when user invokes SAGEBRUSH. Creates session, returns greeting.
     * @param {string} userId
     * @param {string} channel - nowassist | virtualagent | phone
     * @returns {Object} { sessionId: String, greeting: String }
     */
    handleInvocation: function(userId, channel) {
        var sessionId = this.session.createSession(userId, channel);
        var greeting  = gs.getProperty('x_snc_sagebrush.greeting.text',
            'Hi, I\'m SAGEBRUSH, your AI Architect Agent. I can help you with Solution Design or Data Quality Checks. What would you like to work on today?');

        this.auditor.log('invoked', 'SAGEBRUSH invoked via ' + channel, { sessionSysId: sessionId });
        return { sessionId: sessionId, greeting: greeting };
    },

    /**
     * Handles a user message in an active session. Detects intent and routes.
     * @param {string} sessionId
     * @param {string} message - Raw user input (already converted from speech if voice)
     * @returns {Object} { response: String, intent: String }
     */
    handleMessage: function(sessionId, message) {
        var sessionData = this.session.getSession(sessionId);
        if (!sessionData) {
            return { response: 'I could not find your session. Please say SAGEBRUSH to start again.', intent: 'none' };
        }

        var lower = message.toLowerCase();
        var detectedIntent = this._detectIntent(lower, sessionData.intent);

        if (detectedIntent !== sessionData.intent) {
            this.session.updateIntent(sessionId, detectedIntent);
        }

        var response = this._buildResponse(detectedIntent, message, sessionData);
        return { response: response, intent: detectedIntent };
    },

    _detectIntent: function(lowerMessage, currentIntent) {
        // If intent already set and not reset word, keep it
        if (currentIntent !== 'none' && lowerMessage.indexOf('restart') === -1 && lowerMessage.indexOf('start over') === -1) {
            return currentIntent;
        }

        for (var i = 0; i < this.SOLUTION_DESIGN_KEYWORDS.length; i++) {
            if (lowerMessage.indexOf(this.SOLUTION_DESIGN_KEYWORDS[i]) !== -1) {
                return 'solution_design';
            }
        }
        for (var j = 0; j < this.DATA_QUALITY_KEYWORDS.length; j++) {
            if (lowerMessage.indexOf(this.DATA_QUALITY_KEYWORDS[j]) !== -1) {
                return 'data_quality';
            }
        }
        return 'none';
    },

    _buildResponse: function(intent, message, sessionData) {
        switch (intent) {
            case 'solution_design':
                return 'Great, let\'s work on a Solution Design. Tell me what you\'re trying to achieve — describe it in your own words, or share a document and I\'ll read it for you. What are you looking to build or improve?';
            case 'data_quality':
                return this._buildDQResponse(message, sessionData);
            default:
                return 'I can help you with Solution Design or Data Quality Checks. Which would you like to work on?';
        }
    },

    _buildDQResponse: function(message, sessionData) {
        var lower = message ? message.toLowerCase() : '';
        var domains = ['itsm', 'itom', 'grc', 'bcm', 'csm', 'hrsd', 'foundational'];
        var selectedDomain = null;

        for (var i = 0; i < domains.length; i++) {
            if (lower.indexOf(domains[i]) !== -1) { selectedDomain = domains[i]; break; }
        }
        if (lower.indexOf('all') !== -1 || lower.indexOf('full') !== -1) { selectedDomain = 'all'; }

        // No domain named yet — ask the user to choose
        if (!selectedDomain) {
            return 'Sure, I can run a Data Quality check. Which domain would you like me to check? Options are: ITSM, ITOM, GRC, BCM, CSM, HRSD, or Foundational data (users, departments, locations). You can also say "all" for a full instance scan.';
        }

        var engine  = new SAGEBRUSHDQEngine();
        var runId   = engine.startRun(sessionData.sys_id, selectedDomain);
        var summary = engine.getSummary(runId, gs.getUserID());
        return summary;
    },

    type: 'SAGEBRUSHConversationHandler'
};
