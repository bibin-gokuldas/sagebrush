(function bootstrap() {

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHAIProvider', '/**
 * @name SAGEBRUSHAIProvider
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHAIProvider = Class.create();
SAGEBRUSHAIProvider.prototype = {

    initialize: function() {
        this.log       = new GSLog(\'x_snc_sagebrush.ai\', \'SAGEBRUSHAIProvider\');
        this.provider  = gs.getProperty(\'x_snc_sagebrush.ai.provider\', \'nowassist\');
        this.fallback  = gs.getProperty(\'x_snc_sagebrush.ai.fallback_provider\', \'claude\');
        this.fbEnabled = gs.getProperty(\'x_snc_sagebrush.ai.fallback_enabled\', \'true\') === \'true\';
        this.timeoutMs = parseInt(gs.getProperty(\'x_snc_sagebrush.ai.timeout_ms\', \'30000\'), 10);
        this.maxTokens = parseInt(gs.getProperty(\'x_snc_sagebrush.ai.max_tokens\', \'4096\'), 10);
        this.masker    = new SAGEBRUSHDataMasker();
    },

    /**
     * Single entry point for all AI calls in SAGEBRUSH.
     * Routes to configured provider, falls back on failure.
     * @param {string} prompt - The prompt to send
     * @param {Object} context - Additional context (will be masked if external provider)
     * @param {string} domain - Domain for Now Assist license check: itsm|csm|hrsd|grc|itom|bcm
     * @returns {Object} { success: Boolean, text: String, provider: String, tokens: Number, fallbackUsed: Boolean }
     */
    ask: function(prompt, context, domain) {
        var startTime = new GlideDateTime().getNumericValue();
        var result = this._callProvider(this.provider, prompt, context, domain);
        var fallbackUsed = false;

        if (!result.success && this.fbEnabled) {
            this.log.warn(\'Primary provider [\' + this.provider + \'] failed. Trying fallback [\' + this.fallback + \']\');
            var fallbackResult = this._callProvider(this.fallback, prompt, context, domain);
            if (fallbackResult.success) {
                result = fallbackResult;
                fallbackUsed = true;
            } else {
                result = fallbackResult;
            }
        }

        if (!result.success) {
            result.text = \'AI service is temporarily unavailable. Please try again or contact your ServiceNow administrator.\';
            result.success = false;
        }

        result.fallbackUsed = fallbackUsed;
        this._logCall(result, domain, new GlideDateTime().getNumericValue() - startTime);
        return result;
    },

    /**
     * Checks if a domain is covered by the Now Assist license.
     * @param {string} domain
     * @returns {Boolean}
     */
    _isDomainLicensed: function(domain) {
        var licensed = gs.getProperty(\'x_snc_sagebrush.ai.nowassist.licensed_domains\', \'itsm,csm,hrsd\');
        return licensed.split(\',\').indexOf(domain.toLowerCase()) !== -1;
    },

    _callProvider: function(provider, prompt, context, domain) {
        switch (provider) {
            case \'nowassist\': return this._callNowAssist(prompt, context, domain);
            case \'claude\':    return this._callClaude(prompt, context);
            case \'openai\':    return this._callOpenAI(prompt, context);
            default:
                this.log.error(\'Unknown AI provider: \' + provider);
                return { success: false, text: \'\', provider: provider, tokens: 0 };
        }
    },

    _callNowAssist: function(prompt, context, domain) {
        if (!this._isDomainLicensed(domain)) {
            this.log.warn(\'Now Assist not licensed for domain: \' + domain + \'. Triggering fallback.\');
            return { success: false, reason: \'unlicensed_domain\', provider: \'nowassist\', tokens: 0, text: \'\' };
        }

        try {
            // Now Assist Skill API call - Australia release
            var skillInput = {
                input: prompt,
                context: context || {},
                domain: domain
            };
            var response = sn_now_assist.NowAssistSkillAPI.invoke(\'x_snc_sagebrush.SAGEBRUSH\', skillInput);
            if (response && response.output) {
                return { success: true, text: response.output, provider: \'nowassist\', tokens: response.token_count || 0 };
            }
            return { success: false, text: \'\', provider: \'nowassist\', tokens: 0 };
        } catch (e) {
            this.log.error(\'Now Assist call failed: \' + e.message);
            return { success: false, text: \'\', provider: \'nowassist\', tokens: 0, error: e.message };
        }
    },

    _callClaude: function(prompt, context) {
        var apiKey = gs.getProperty(\'x_snc_sagebrush.ai.claude.api_key\', \'\');
        if (!apiKey || apiKey.length === 0) {
            this.log.warn(\'Claude API key not configured.\');
            return { success: false, text: \'\', provider: \'claude\', tokens: 0 };
        }

        var sendRecordData = gs.getProperty(\'x_snc_sagebrush.ai.external.send_record_data\', \'false\') === \'true\';
        var safeContext = sendRecordData ? context : (this.masker.mask(context || {}).maskedData);

        try {
            var rm = new sn_ih.RESTMessage(\'x_snc_sagebrush.claude\', \'ask\');
            rm.setRequestHeader(\'x-api-key\', apiKey);
            rm.setRequestHeader(\'anthropic-version\', \'2023-06-01\');
            rm.setRequestHeader(\'content-type\', \'application/json\');

            var model = gs.getProperty(\'x_snc_sagebrush.ai.claude.model\', \'claude-opus-4-6\');
            var body = JSON.stringify({
                model: model,
                max_tokens: this.maxTokens,
                messages: [{ role: \'user\', content: prompt + \'\\n\\nContext: \' + JSON.stringify(safeContext) }]
            });
            rm.setRequestBody(body);

            var response = rm.execute();
            var responseBody = JSON.parse(response.getBody());

            if (responseBody && responseBody.content && responseBody.content[0]) {
                return {
                    success: true,
                    text: responseBody.content[0].text,
                    provider: \'claude\',
                    tokens: (responseBody.usage && responseBody.usage.output_tokens) || 0
                };
            }
            return { success: false, text: \'\', provider: \'claude\', tokens: 0 };
        } catch (e) {
            this.log.error(\'Claude API call failed: \' + e.message);
            return { success: false, text: \'\', provider: \'claude\', tokens: 0, error: e.message };
        }
    },

    _callOpenAI: function(prompt, context) {
        var apiKey = gs.getProperty(\'x_snc_sagebrush.ai.openai.api_key\', \'\');
        if (!apiKey || apiKey.length === 0) {
            this.log.warn(\'OpenAI API key not configured.\');
            return { success: false, text: \'\', provider: \'openai\', tokens: 0 };
        }

        var sendRecordData = gs.getProperty(\'x_snc_sagebrush.ai.external.send_record_data\', \'false\') === \'true\';
        var safeContext = sendRecordData ? context : (this.masker.mask(context || {}).maskedData);

        try {
            var rm = new sn_ih.RESTMessage(\'x_snc_sagebrush.openai\', \'ask\');
            rm.setRequestHeader(\'Authorization\', \'Bearer \' + apiKey);
            rm.setRequestHeader(\'content-type\', \'application/json\');

            var model = gs.getProperty(\'x_snc_sagebrush.ai.openai.model\', \'gpt-4o\');
            var body = JSON.stringify({
                model: model,
                max_tokens: this.maxTokens,
                messages: [{ role: \'user\', content: prompt + \'\\n\\nContext: \' + JSON.stringify(safeContext) }]
            });
            rm.setRequestBody(body);

            var response = rm.execute();
            var responseBody = JSON.parse(response.getBody());

            if (responseBody && responseBody.choices && responseBody.choices[0]) {
                return {
                    success: true,
                    text: responseBody.choices[0].message.content,
                    provider: \'openai\',
                    tokens: (responseBody.usage && responseBody.usage.completion_tokens) || 0
                };
            }
            return { success: false, text: \'\', provider: \'openai\', tokens: 0 };
        } catch (e) {
            this.log.error(\'OpenAI API call failed: \' + e.message);
            return { success: false, text: \'\', provider: \'openai\', tokens: 0, error: e.message };
        }
    },

    _logCall: function(result, domain, durationMs) {
        try {
            var aiLog = new GlideRecord(\'x_snc_sagebrush_ai_log\');
            aiLog.initialize();
            aiLog.setValue(\'provider\', result.provider || this.provider);
            aiLog.setValue(\'domain\', domain || \'\');
            aiLog.setValue(\'fallback_used\', result.fallbackUsed || false);
            aiLog.setValue(\'token_count\', result.tokens || 0);
            aiLog.setValue(\'response_ms\', durationMs || 0);
            aiLog.setValue(\'success\', result.success);
            aiLog.setValue(\'error_message\', result.error || \'\');
            aiLog.insert();
        } catch (e) {
            this.log.warn(\'Failed to write AI log entry: \' + e.message);
        }
    },

    type: \'SAGEBRUSHAIProvider\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHAuditLogger', '/**
 * @name SAGEBRUSHAuditLogger
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHAuditLogger = Class.create();
SAGEBRUSHAuditLogger.prototype = {

    VALID_EVENTS: [\'invoked\', \'ai_call\', \'instance_scan\', \'dq_scan\', \'design_generated\', \'cross_scope_read\'],

    initialize: function() {
        this.gslog = new GSLog(\'x_snc_sagebrush.audit\', \'SAGEBRUSHAuditLogger\');
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
                this.gslog.warn(\'SAGEBRUSHAuditLogger: unknown eventType [\' + eventType + \'], skipping audit write\');
                return;
            }
            var opts = options || {};
            var audit = new GlideRecord(\'x_snc_sagebrush_audit\');
            audit.initialize();
            audit.setValue(\'user_sys_id\', gs.getUserID());
            audit.setValue(\'event_type\', eventType);
            audit.setValue(\'detail\', detail || \'\');
            if (opts.sessionSysId) { audit.setValue(\'session\', opts.sessionSysId); }
            if (opts.tableName)    { audit.setValue(\'table_name\', opts.tableName); }
            if (opts.recordCount)  { audit.setValue(\'record_count\', opts.recordCount); }
            var insertResult = audit.insert();
            if (!insertResult) {
                this.gslog.warn(\'Audit insert returned null for eventType: \' + eventType);
            }
        } catch (e) {
            this.gslog.warn(\'Audit log write failed (non-fatal): \' + e.message);
        }
    },

    type: \'SAGEBRUSHAuditLogger\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHConversationHandler', '/**
 * @name SAGEBRUSHConversationHandler
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHConversationHandler = Class.create();
SAGEBRUSHConversationHandler.prototype = {

    SOLUTION_DESIGN_KEYWORDS: [\'solution design\', \'design\', \'hld\', \'lld\', \'architecture\', \'build\', \'implement\', \'requirement\'],
    DATA_QUALITY_KEYWORDS:    [\'data quality\', \'dq\', \'quality check\', \'data check\', \'check data\', \'clean data\', \'duplicate\', \'missing data\'],

    initialize: function(dependencies) {
        this.log     = new GSLog(\'x_snc_sagebrush.conversation\', \'SAGEBRUSHConversationHandler\');
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
        var greeting  = gs.getProperty(\'x_snc_sagebrush.greeting.text\',
            \'Hi, I\\\'m SAGEBRUSH, your AI Architect Agent. I can help you with Solution Design or Data Quality Checks. What would you like to work on today?\');

        this.auditor.log(\'invoked\', \'SAGEBRUSH invoked via \' + channel, { sessionSysId: sessionId });
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
            return { response: \'I could not find your session. Please say SAGEBRUSH to start again.\', intent: \'none\' };
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
        if (currentIntent !== \'none\' && lowerMessage.indexOf(\'restart\') === -1 && lowerMessage.indexOf(\'start over\') === -1) {
            return currentIntent;
        }

        for (var i = 0; i < this.SOLUTION_DESIGN_KEYWORDS.length; i++) {
            if (lowerMessage.indexOf(this.SOLUTION_DESIGN_KEYWORDS[i]) !== -1) {
                return \'solution_design\';
            }
        }
        for (var j = 0; j < this.DATA_QUALITY_KEYWORDS.length; j++) {
            if (lowerMessage.indexOf(this.DATA_QUALITY_KEYWORDS[j]) !== -1) {
                return \'data_quality\';
            }
        }
        return \'none\';
    },

    _buildResponse: function(intent, message, sessionData) {
        switch (intent) {
            case \'solution_design\':
                return \'Great, let\\\'s work on a Solution Design. Tell me what you\\\'re trying to achieve — describe it in your own words, or share a document and I\\\'ll read it for you. What are you looking to build or improve?\';
            case \'data_quality\':
                return this._buildDQResponse(message, sessionData);
            default:
                return \'I can help you with Solution Design or Data Quality Checks. Which would you like to work on?\';
        }
    },

    _buildDQResponse: function(message, sessionData) {
        var lower = message ? message.toLowerCase() : \'\';
        var domains = [\'itsm\', \'itom\', \'grc\', \'bcm\', \'csm\', \'hrsd\', \'foundational\'];
        var selectedDomain = null;

        for (var i = 0; i < domains.length; i++) {
            if (lower.indexOf(domains[i]) !== -1) { selectedDomain = domains[i]; break; }
        }
        if (lower.indexOf(\'all\') !== -1 || lower.indexOf(\'full\') !== -1) { selectedDomain = \'all\'; }

        // No domain named yet — ask the user to choose
        if (!selectedDomain) {
            return \'Sure, I can run a Data Quality check. Which domain would you like me to check? Options are: ITSM, ITOM, GRC, BCM, CSM, HRSD, or Foundational data (users, departments, locations). You can also say "all" for a full instance scan.\';
        }

        var engine  = new SAGEBRUSHDQEngine();
        var runId   = engine.startRun(sessionData.sys_id, selectedDomain);
        var summary = engine.getSummary(runId, gs.getUserID());
        return summary;
    },

    type: \'SAGEBRUSHConversationHandler\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHDQAIEngine', '/**
 * @name SAGEBRUSHDQAIEngine
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHDQAIEngine = Class.create();
SAGEBRUSHDQAIEngine.prototype = {

    RESULT_TABLE: \'x_snc_sagebrush_dq_result\',
    RUN_TABLE:    \'x_snc_sagebrush_dq_run\',

    initialize: function(dependencies) {
        this.log    = new GSLog(\'x_snc_sagebrush.dq.ai\', \'SAGEBRUSHDQAIEngine\');
        this.ai     = (dependencies && dependencies.ai)     || new SAGEBRUSHAIProvider();
        this.masker = (dependencies && dependencies.masker) || new SAGEBRUSHDataMasker();
    },

    /**
     * Analyses statistical summaries of a DQ run for AI-detected anomalies.
     * Never sends raw record data to external AI — uses masked statistical summaries only.
     * @param {string} runSysId
     * @returns {Number} count of AI anomalies added to x_snc_sagebrush_dq_result
     */
    analyseRun: function(runSysId) {
        var summary = this._buildStatisticalSummary(runSysId);
        var maskedSummary = this.masker.mask(summary).maskedData;

        var prompt = \'You are a ServiceNow data quality analyst. Review this statistical summary of a ServiceNow instance DQ scan. \' +
            \'Identify any patterns, anomalies, or concerns NOT already flagged as individual rule violations. \' +
            \'Respond with a JSON array of findings: [{ "domain": "...", "dimension": "...", "severity": "high|medium|low", "finding": "...", "recommendation": "..." }]. \' +
            \'If no additional anomalies found, return empty array []. \' +
            \'Statistical summary: \' + JSON.stringify(maskedSummary);

        var aiResult = this.ai.ask(prompt, {}, \'itsm\');
        if (!aiResult.success) { return 0; }

        try {
            var jsonMatch = aiResult.text.match(/\\[[\\s\\S]*\\]/);
            if (!jsonMatch) { return 0; }
            var findings = JSON.parse(jsonMatch[0]);
            return this._saveAIFindings(runSysId, findings);
        } catch (e) {
            this.log.warn(\'AI findings parse failed: \' + e.message);
            return 0;
        }
    },

    _buildStatisticalSummary: function(runSysId) {
        var summary = { run_id: runSysId, domains: {} };

        var result = new GlideRecord(this.RESULT_TABLE);
        result.addQuery(\'dq_run\', runSysId);
        result.query();

        while (result.next()) {
            var domain    = result.getValue(\'domain\') || \'unknown\';
            var severity  = result.getValue(\'severity\') || \'low\';
            var dimension = result.getValue(\'dimension\') || \'unknown\';

            if (!summary.domains[domain]) {
                summary.domains[domain] = { total: 0, by_severity: {}, by_dimension: {} };
            }
            summary.domains[domain].total++;
            summary.domains[domain].by_severity[severity]   = (summary.domains[domain].by_severity[severity]  || 0) + 1;
            summary.domains[domain].by_dimension[dimension] = (summary.domains[domain].by_dimension[dimension] || 0) + 1;
        }
        return summary;
    },

    _saveAIFindings: function(runSysId, findings) {
        var saved = 0;
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            try {
                var gr = new GlideRecord(this.RESULT_TABLE);
                gr.initialize();
                gr.setValue(\'dq_run\',           runSysId);
                gr.setValue(\'domain\',           f.domain || \'unknown\');
                gr.setValue(\'dimension\',        f.dimension || \'accuracy\');
                gr.setValue(\'severity\',         f.severity || \'medium\');
                gr.setValue(\'result_message\',   f.finding || \'\');
                gr.setValue(\'remediation_hint\', f.recommendation || \'\');
                gr.setValue(\'detected_by\',      \'ai\');
                gr.setValue(\'status\',           \'open\');
                gr.insert();
                saved++;
            } catch (e) { this.log.warn(\'Failed to save AI finding: \' + e.message); }
        }
        return saved;
    },

    type: \'SAGEBRUSHDQAIEngine\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHDQEngine', '/**
 * @name SAGEBRUSHDQEngine
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHDQEngine = Class.create();
SAGEBRUSHDQEngine.prototype = {

    RUN_TABLE: \'x_snc_sagebrush_dq_run\',

    initialize: function(dependencies) {
        this.log        = new GSLog(\'x_snc_sagebrush.dq\', \'SAGEBRUSHDQEngine\');
        this.rules      = (dependencies && dependencies.rules)      || new SAGEBRUSHDQRuleEngine();
        this.aiEngine   = (dependencies && dependencies.aiEngine)   || new SAGEBRUSHDQAIEngine();
        this.scorer     = (dependencies && dependencies.scorer)     || new SAGEBRUSHDQScorer();
        this.auditor    = (dependencies && dependencies.auditor)    || new SAGEBRUSHAuditLogger();
        this.remediator = (dependencies && dependencies.remediator) || new SAGEBRUSHDQRemediator();
    },

    /**
     * Starts a DQ run — creates run record, executes rules, AI analysis, scores.
     * @param {string} sessionId - SAGEBRUSH session sys_id
     * @param {string} domain - \'all\' | \'itsm\' | \'itom\' | \'grc\' | \'bcm\' | \'csm\' | \'hrsd\' | \'foundational\'
     * @returns {string} runSysId
     */
    startRun: function(sessionId, domain) {
        var runType = (domain === \'all\') ? \'full\' : \'domain\';

        var run = new GlideRecord(this.RUN_TABLE);
        run.initialize();
        run.setValue(\'run_type\',     runType);
        run.setValue(\'domain\',       domain !== \'all\' ? domain : \'\');
        run.setValue(\'triggered_by\', sessionId ? \'conversation\' : \'scheduled\');
        run.setValue(\'session\',      sessionId || \'\');
        run.setValue(\'state\',        \'running\');
        var runId = run.insert();

        this.auditor.log(\'dq_scan\', \'DQ scan started: \' + domain, { sessionSysId: sessionId });

        try {
            var ruleResult  = (domain === \'all\') ? this.rules.runAll(runId) : this.rules.runDomain(runId, domain);
            var aiAnomalies = this.aiEngine.analyseRun(runId);
            var scores      = this.scorer.scoreRun(runId);

            // Update run with counts
            run = new GlideRecord(this.RUN_TABLE);
            run.get(runId);
            run.setValue(\'state\',        \'complete\');
            run.setValue(\'checks_run\',   ruleResult.checks_run);
            run.setValue(\'issues_found\', ruleResult.issues_found + aiAnomalies);
            run.setValue(\'dq_score\',     scores.overall);
            run.update();

            // Update severity counts via GlideAggregate
            this._updateSeverityCounts(runId);
        } catch (e) {
            this.log.error(\'DQ run failed: \' + e.message);
            run = new GlideRecord(this.RUN_TABLE);
            run.get(runId);
            run.setValue(\'state\', \'failed\');
            run.update();
        }

        return runId;
    },

    /**
     * Returns a role-appropriate DQ summary for conversational response.
     * @param {string} runSysId
     * @param {string} userId
     * @returns {string}
     */
    getSummary: function(runSysId, userId) {
        var roles    = new SAGEBRUSHRoleHelper();
        var userRole = roles.getUserRole(userId);
        var run      = new GlideRecord(this.RUN_TABLE);
        if (!run.get(runSysId)) { return \'Data Quality run not found.\'; }

        var score    = parseFloat(run.getValue(\'dq_score\') || \'0\');
        var issues   = parseInt(run.getValue(\'issues_found\') || \'0\', 10);
        var critical = parseInt(run.getValue(\'critical_count\') || \'0\', 10);
        var domain   = run.getValue(\'domain\') || \'all domains\';

        if (userRole === \'architect\' || userRole === \'admin\') {
            return \'DQ Scan complete for \' + domain + \'.\\n\' +
                \'Score: \' + score.toFixed(1) + \'/100\\n\' +
                \'Total issues: \' + issues + \' (\' + critical + \' critical)\\n\' +
                \'Results are in x_snc_sagebrush_dq_result. Would you like me to walk through the critical items?\';
        }

        // Viewer / business stakeholder — plain language
        var grade = score >= 90 ? \'Excellent\' : (score >= 75 ? \'Good\' : (score >= 60 ? \'Needs Attention\' : \'Poor\'));
        return \'Your data quality for \' + domain + \' is rated \' + grade + \' (\' + score.toFixed(0) + \'/100). \' +
            \'There are \' + issues + \' items that need attention\' +
            (critical > 0 ? \', including \' + critical + \' that are urgent.\' : \'.\');
    },

    _updateSeverityCounts: function(runId) {
        var counts = { critical: 0, high: 0, medium: 0, low: 0 };

        var agg = new GlideAggregate(\'x_snc_sagebrush_dq_result\');
        agg.addQuery(\'dq_run\', runId);
        agg.addAggregate(\'COUNT\', \'severity\');
        agg.groupBy(\'severity\');
        agg.query();
        while (agg.next()) {
            var sev = agg.getValue(\'severity\');
            var cnt = parseInt(agg.getAggregate(\'COUNT\', \'severity\'), 10);
            if (counts.hasOwnProperty(sev)) { counts[sev] = cnt; }
        }

        var run = new GlideRecord(this.RUN_TABLE);
        if (run.get(runId)) {
            run.setValue(\'critical_count\', counts.critical);
            run.setValue(\'high_count\',     counts.high);
            run.setValue(\'medium_count\',   counts.medium);
            run.setValue(\'low_count\',      counts.low);
            run.update();
        }
    },

    type: \'SAGEBRUSHDQEngine\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHDQRemediator', '/**
 * @name SAGEBRUSHDQRemediator
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHDQRemediator = Class.create();
SAGEBRUSHDQRemediator.prototype = {

    RESULT_TABLE: \'x_snc_sagebrush_dq_result\',

    DOMAIN_GROUPS: {
        \'itsm\':         \'Service Desk\',
        \'itom\':         \'CMDB Team\',
        \'grc\':          \'Risk and Compliance\',
        \'bcm\':          \'Business Continuity Team\',
        \'csm\':          \'Customer Service Operations\',
        \'hrsd\':         \'HR Operations\',
        \'foundational\': \'Platform Administration\'
    },

    initialize: function(dependencies) {
        this.log   = new GSLog(\'x_snc_sagebrush.dq.remediation\', \'SAGEBRUSHDQRemediator\');
        this.ai    = (dependencies && dependencies.ai)    || new SAGEBRUSHAIProvider();
        this.roles = (dependencies && dependencies.roles) || new SAGEBRUSHRoleHelper();
    },

    /**
     * Generates role-appropriate remediation hint for a DQ result.
     * Architect/Dev: technical detail. Admin: step-by-step. Viewer: plain language.
     * @param {string} resultSysId - x_snc_sagebrush_dq_result sys_id
     * @param {string} userId
     * @returns {string}
     */
    getHint: function(resultSysId, userId) {
        var userRole = this.roles.getUserRole(userId);
        var result   = new GlideRecord(this.RESULT_TABLE);
        if (!result.get(resultSysId)) { return \'Result not found.\'; }

        var message   = result.getValue(\'result_message\') || \'\';
        var table     = result.getValue(\'table_name\')     || \'\';
        var dimension = result.getValue(\'dimension\')      || \'\';
        var domain    = result.getValue(\'domain\')         || \'\';

        // Try to get AI-generated hint first (it may have been set at scan time)
        var existingHint = result.getValue(\'remediation_hint\') || \'\';
        if (existingHint.length > 10) { return this._formatHintForRole(existingHint, userRole); }

        // Generate hint via AI
        var roleLabel    = userRole === \'architect\' ? \'developer\' : (userRole === \'admin\' ? \'admin\' : \'business user\');
        var roleInstruct = userRole === \'architect\'
            ? \'Include GlideRecord query example and fix script.\'
            : (userRole === \'admin\'
                ? \'Use plain language step-by-step instructions.\'
                : \'Explain in simple non-technical terms what the business user should do or who to contact.\');
        var prompt = \'You are a ServiceNow \' + roleLabel + \'. \' +
            \'Provide a concise remediation hint for this data quality issue. \' +
            \'Issue: \' + message + \'. Table: \' + table + \'. Dimension: \' + dimension + \'. Domain: \' + domain + \'. \' +
            roleInstruct;

        var aiResult = this.ai.ask(prompt, {}, domain);
        var hint = aiResult.success ? aiResult.text : \'Please review and update the record to resolve this data quality issue.\';

        // Cache hint on result record
        result.setValue(\'remediation_hint\', hint);
        result.update();

        return this._formatHintForRole(hint, userRole);
    },

    _formatHintForRole: function(hint, role) {
        if (role === \'architect\') { return hint; }
        if (role === \'admin\')     { return hint; }
        // Viewer — truncate technical details
        var lines = hint.split(\'\\n\');
        return lines.slice(0, 3).join(\'\\n\');
    },

    type: \'SAGEBRUSHDQRemediator\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHDQRuleEngine', '/**
 * @name SAGEBRUSHDQRuleEngine
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHDQRuleEngine = Class.create();
SAGEBRUSHDQRuleEngine.prototype = {

    CHECK_TABLE:  \'x_snc_sagebrush_dq_check\',
    RESULT_TABLE: \'x_snc_sagebrush_dq_result\',
    RUN_TABLE:    \'x_snc_sagebrush_dq_run\',
    CHUNK_SIZE:   500,

    SEVERITY_WEIGHTS: { critical: 10, high: 5, medium: 2, low: 1 },

    initialize: function() {
        this.log = new GSLog(\'x_snc_sagebrush.dq.rules\', \'SAGEBRUSHDQRuleEngine\');
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
            this.log.warn(\'No active checks found for domain: \' + domain);
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
                this.log.error(\'Check failed [\' + checks[i].check_name + \']: \' + e.message);
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
        var domains = [\'foundational\', \'itsm\', \'itom\', \'grc\', \'bcm\', \'csm\', \'hrsd\'];
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
        gr.addQuery(\'active\', true);
        if (domain && domain !== \'all\') { gr.addQuery(\'domain\', domain); }
        gr.query();
        while (gr.next()) {
            checks.push({
                sys_id:           gr.getValue(\'sys_id\'),
                check_name:       gr.getValue(\'check_name\'),
                domain:           gr.getValue(\'domain\'),
                dimension:        gr.getValue(\'dimension\'),
                severity:         gr.getValue(\'severity\'),
                target_table:     gr.getValue(\'target_table\'),
                check_query:      gr.getValue(\'check_query\'),
                check_script:     gr.getValue(\'check_script\'),
                check_type:       gr.getValue(\'check_type\'),
                message_template: gr.getValue(\'message_template\')
            });
        }
        return checks;
    },

    _executeCheck: function(check, runSysId) {
        if (check.check_type === \'script\' && check.check_script) {
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
                var sysId   = gr.getValue(\'sys_id\');
                var message = this._renderMessage(check.message_template, gr);
                var resultId = this._saveResult(runSysId, check, check.target_table, sysId, message, \'rule\');
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
        this.log.warn(\'Script check [\' + check.check_name + \'] skipped — eval not supported in scoped apps.\');
        return [];
    },

    _saveResult: function(runSysId, check, tableName, recordSysId, message, detectedBy) {
        try {
            var gr = new GlideRecord(this.RESULT_TABLE);
            gr.initialize();
            gr.setValue(\'dq_run\',        runSysId);
            gr.setValue(\'dq_check\',      check.sys_id);
            gr.setValue(\'domain\',        check.domain);
            gr.setValue(\'dimension\',     check.dimension);
            gr.setValue(\'severity\',      check.severity);
            gr.setValue(\'table_name\',    tableName);
            gr.setValue(\'record_sys_id\', recordSysId || \'\');
            gr.setValue(\'result_message\', message);
            gr.setValue(\'detected_by\',   detectedBy || \'rule\');
            gr.setValue(\'status\',        \'open\');
            return gr.insert();
        } catch (e) {
            this.log.warn(\'Failed to save DQ result: \' + e.message);
            return null;
        }
    },

    _renderMessage: function(template, gr) {
        if (!template) { return \'Issue found on \' + gr.getValue(\'sys_id\'); }
        return template.replace(\'{record}\', gr.getDisplayValue() || gr.getValue(\'sys_id\'));
    },

    type: \'SAGEBRUSHDQRuleEngine\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHDQScorer', '/**
 * @name SAGEBRUSHDQScorer
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHDQScorer = Class.create();
SAGEBRUSHDQScorer.prototype = {

    RESULT_TABLE: \'x_snc_sagebrush_dq_result\',
    RUN_TABLE:    \'x_snc_sagebrush_dq_run\',
    CHECK_TABLE:  \'x_snc_sagebrush_dq_check\',

    SEVERITY_DEDUCTIONS: { critical: 10, high: 5, medium: 2, low: 1 },

    initialize: function() {
        this.log = new GSLog(\'x_snc_sagebrush.dq.scorer\', \'SAGEBRUSHDQScorer\');
    },

    /**
     * Calculates DQ scores for a completed run.
     * @param {string} runSysId
     * @returns {Object} { overall: Number, by_domain: Object, by_dimension: Object }
     */
    scoreRun: function(runSysId) {
        var run = new GlideRecord(this.RUN_TABLE);
        if (!run.get(runSysId)) { return { overall: 0, by_domain: {}, by_dimension: {} }; }

        var checksRun = parseInt(run.getValue(\'checks_run\') || \'0\', 10);
        if (checksRun === 0) { return { overall: 100, by_domain: {}, by_dimension: {} }; }

        var deduction = 0;
        deduction += parseInt(run.getValue(\'critical_count\') || \'0\', 10) * this.SEVERITY_DEDUCTIONS.critical;
        deduction += parseInt(run.getValue(\'high_count\')     || \'0\', 10) * this.SEVERITY_DEDUCTIONS.high;
        deduction += parseInt(run.getValue(\'medium_count\')   || \'0\', 10) * this.SEVERITY_DEDUCTIONS.medium;
        deduction += parseInt(run.getValue(\'low_count\')      || \'0\', 10) * this.SEVERITY_DEDUCTIONS.low;

        var overall = Math.max(0, Math.min(100, 100 - deduction));

        var byDomain    = this._scoreByDomain(runSysId);
        var byDimension = this._scoreByDimension(runSysId);

        // Update run record with computed score
        run.setValue(\'dq_score\', overall);
        run.update();

        return { overall: overall, by_domain: byDomain, by_dimension: byDimension };
    },

    /**
     * Calculates the DQ score for a specific domain within a run.
     * @param {string} runSysId
     * @param {string} domain
     * @returns {Number} 0-100
     */
    scoreDomain: function(runSysId, domain) {
        var deduction = 0;
        var gr = new GlideRecord(this.RESULT_TABLE);
        gr.addQuery(\'dq_run\', runSysId);
        gr.addQuery(\'domain\', domain);
        gr.query();

        while (gr.next()) {
            var sev = gr.getValue(\'severity\') || \'low\';
            deduction += this.SEVERITY_DEDUCTIONS[sev] || 1;
        }

        return Math.max(0, Math.min(100, 100 - deduction));
    },

    _scoreByDomain: function(runSysId) {
        var domains = [\'foundational\', \'itsm\', \'itom\', \'grc\', \'bcm\', \'csm\', \'hrsd\'];
        var scores  = {};
        for (var i = 0; i < domains.length; i++) {
            scores[domains[i]] = this.scoreDomain(runSysId, domains[i]);
        }
        return scores;
    },

    _scoreByDimension: function(runSysId) {
        var dimensions = [\'completeness\', \'accuracy\', \'consistency\', \'referential\', \'staleness\', \'duplicate\', \'compliance\'];
        var scores     = {};
        for (var i = 0; i < dimensions.length; i++) {
            var deduction = 0;
            var gr = new GlideRecord(this.RESULT_TABLE);
            gr.addQuery(\'dq_run\', runSysId);
            gr.addQuery(\'dimension\', dimensions[i]);
            gr.query();
            while (gr.next()) {
                deduction += this.SEVERITY_DEDUCTIONS[gr.getValue(\'severity\')] || 1;
            }
            scores[dimensions[i]] = Math.max(0, Math.min(100, 100 - deduction));
        }
        return scores;
    },

    type: \'SAGEBRUSHDQScorer\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHDataMasker', '/**
 * @name SAGEBRUSHDataMasker
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHDataMasker = Class.create();
SAGEBRUSHDataMasker.prototype = {

    PII_FIELDS: [\'email\', \'phone\', \'mobile_phone\', \'first_name\', \'last_name\',
                 \'name\', \'employee_id\', \'user_name\', \'password\', \'sys_id\'],

    initialize: function() {
        this.log = new GSLog(\'x_snc_sagebrush.masker\', \'SAGEBRUSHDataMasker\');
    },

    /**
     * Masks PII fields in a data object before sending to external AI.
     * Non-PII fields are preserved. Numeric and boolean values are preserved.
     * @param {Object} dataObj - Plain JS object with fields to mask
     * @returns {Object} { maskedData: Object, tokenMap: Object }
     */
    mask: function(dataObj) {
        var maskedData = {};
        var tokenMap = {};
        var tokenCounter = 0;

        for (var key in dataObj) {
            if (!dataObj.hasOwnProperty(key)) {
                continue;
            }

            var value = dataObj[key];
            var isPII = this._isPIIField(key);

            if (isPII && typeof value === \'string\' && value.length > 0) {
                tokenCounter++;
                var token = \'[\' + key.toUpperCase() + \'_\' + tokenCounter + \']\';
                maskedData[key] = token;
                tokenMap[token] = value;
            } else {
                maskedData[key] = value;
            }
        }

        return { maskedData: maskedData, tokenMap: tokenMap };
    },

    /**
     * Masks an array of objects (e.g. a list of GlideRecord-sourced rows).
     * @param {Array} dataArray
     * @returns {Object} { maskedData: Array, tokenMap: Object }
     */
    maskArray: function(dataArray) {
        var allMasked = [];
        var allTokenMap = {};

        for (var i = 0; i < dataArray.length; i++) {
            var result = this.mask(dataArray[i]);
            allMasked.push(result.maskedData);
            for (var token in result.tokenMap) {
                if (result.tokenMap.hasOwnProperty(token)) {
                    allTokenMap[token] = result.tokenMap[token];
                }
            }
        }

        return { maskedData: allMasked, tokenMap: allTokenMap };
    },

    _isPIIField: function(fieldName) {
        var lower = fieldName.toLowerCase();
        for (var i = 0; i < this.PII_FIELDS.length; i++) {
            if (lower === this.PII_FIELDS[i]) {
                return true;
            }
        }
        return false;
    },

    type: \'SAGEBRUSHDataMasker\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHDesignWriter', '/**
 * @callable_from_other_scopes true
 */
/**
 * @name SAGEBRUSHDesignWriter
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHDesignWriter = Class.create();
SAGEBRUSHDesignWriter.prototype = {

    SESSION_TABLE: \'x_snc_sagebrush_session\',
    REQ_TABLE:     \'x_snc_sagebrush_requirement\',
    OOB_TABLE:     \'x_snc_sagebrush_oob_map\',
    KB_TABLE:      \'kb_knowledge\',

    initialize: function(dependencies) {
        this.log = new GSLog(\'x_snc_sagebrush.writer\', \'SAGEBRUSHDesignWriter\');
        this.ai  = (dependencies && dependencies.ai)  || new SAGEBRUSHAIProvider();
        this.sm  = (dependencies && dependencies.sm)  || new SAGEBRUSHSessionManager();
    },

    /**
     * Generates a High-Level Design KB article for the given session.
     * @param {string} sessionId - x_snc_sagebrush_session sys_id
     * @returns {string} sys_id of the created KB article, or null on failure
     */
    generateHLD: function(sessionId) {
        try {
            var ctx = this._buildDesignContext(sessionId);
            var prompt = this._buildHLDPrompt(ctx);
            var aiResult = this.ai.ask(prompt, { session_id: sessionId }, \'itsm\');
            var content = (aiResult && aiResult.success && aiResult.text)
                ? aiResult.text
                : this._fallbackHLD(ctx);
            var title = \'SAGEBRUSH HLD - \' + new GlideDateTime().getDisplayValue();
            var categoryId = this._getOrCreateCategory();
            var articleSysId = this._saveKBArticle(title, content, categoryId);
            if (articleSysId) {
                this._linkToSession(sessionId, \'hld_article\', articleSysId);
            }
            return articleSysId || null;
        } catch (e) {
            this.log.error(\'generateHLD failed: \' + e.message);
            return null;
        }
    },

    /**
     * Generates a Low-Level Design KB article for the given session.
     * @param {string} sessionId - x_snc_sagebrush_session sys_id
     * @param {string} hldSysId  - sys_id of the previously generated HLD article
     * @returns {string} sys_id of the created KB article, or null on failure
     */
    generateLLD: function(sessionId, hldSysId) {
        try {
            var ctx = this._buildDesignContext(sessionId);
            ctx.hldSysId = hldSysId;
            var prompt = this._buildLLDPrompt(ctx);
            var aiResult = this.ai.ask(prompt, { session_id: sessionId, hld_sys_id: hldSysId }, \'itsm\');
            var content = (aiResult && aiResult.success && aiResult.text)
                ? aiResult.text
                : this._fallbackLLD(ctx);
            var title = \'SAGEBRUSH LLD - \' + new GlideDateTime().getDisplayValue();
            var categoryId = this._getOrCreateCategory();
            var articleSysId = this._saveKBArticle(title, content, categoryId);
            if (articleSysId) {
                this._linkToSession(sessionId, \'lld_article\', articleSysId);
            }
            return articleSysId || null;
        } catch (e) {
            this.log.error(\'generateLLD failed: \' + e.message);
            return null;
        }
    },

    // ---------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------

    /**
     * Builds a design context object from confirmed requirements and OOB mappings.
     * @param {string} sessionId
     * @returns {Object} ctx with requirements[] and oobMappings[]
     */
    _buildDesignContext: function(sessionId) {
        var requirements = [];
        var gr = new GlideRecord(this.REQ_TABLE);
        gr.addQuery(\'session\', sessionId);
        gr.addQuery(\'confirmed\', true);
        gr.orderBy(\'sequence\');
        gr.query();
        while (gr.next()) {
            requirements.push({
                sys_id:           gr.getValue(\'sys_id\'),
                requirement_text: gr.getValue(\'requirement_text\'),
                requirement_type: gr.getValue(\'requirement_type\'),
                priority:         gr.getValue(\'priority\'),
                sequence:         parseInt(gr.getValue(\'sequence\') || \'0\', 10)
            });
        }

        var oobMappings = [];
        var om = new GlideRecord(this.OOB_TABLE);
        om.addQuery(\'session\', sessionId);
        om.query();
        while (om.next()) {
            oobMappings.push({
                sys_id:       om.getValue(\'sys_id\'),
                feature:      om.getValue(\'feature\'),
                module:       om.getValue(\'module\'),
                fit_score:    om.getValue(\'fit_score\'),
                rationale:    om.getValue(\'rationale\')
            });
        }

        return {
            sessionId:   sessionId,
            requirements: requirements,
            oobMappings:  oobMappings
        };
    },

    /**
     * Builds the AI prompt for HLD generation.
     * @param {Object} ctx - design context from _buildDesignContext
     * @returns {string} prompt string
     */
    _buildHLDPrompt: function(ctx) {
        var reqLines = [];
        for (var i = 0; i < ctx.requirements.length; i++) {
            var req = ctx.requirements[i];
            reqLines.push((i + 1) + \'. [\' + (req.priority || \'medium\').toUpperCase() + \'] \' + req.requirement_text);
        }
        var oobLines = [];
        for (var j = 0; j < ctx.oobMappings.length; j++) {
            var oob = ctx.oobMappings[j];
            oobLines.push(\'- \' + oob.feature + \' -> \' + oob.module + \' (fit: \' + oob.fit_score + \')\');
        }
        return \'You are a ServiceNow Solution Architect. Generate a High-Level Design (HLD) document in Markdown. \' +
            \'Include: Executive Summary, Solution Overview, Key Components, Integration Points, Data Flow, \' +
            \'ServiceNow Modules Used, Estimated Scope.\\n\\n\' +
            \'Confirmed Requirements:\\n\' + reqLines.join(\'\\n\') + \'\\n\\n\' +
            \'OOB Capability Mappings:\\n\' + (oobLines.length ? oobLines.join(\'\\n\') : \'None identified.\');
    },

    /**
     * Builds the AI prompt for LLD generation.
     * @param {Object} ctx - design context from _buildDesignContext (with hldSysId)
     * @returns {string} prompt string
     */
    _buildLLDPrompt: function(ctx) {
        var reqLines = [];
        for (var i = 0; i < ctx.requirements.length; i++) {
            var req = ctx.requirements[i];
            reqLines.push((i + 1) + \'. [\' + (req.priority || \'medium\').toUpperCase() + \'] \' + req.requirement_text);
        }
        var oobLines = [];
        for (var j = 0; j < ctx.oobMappings.length; j++) {
            var oob = ctx.oobMappings[j];
            oobLines.push(\'- \' + oob.feature + \' -> \' + oob.module + \' (fit: \' + oob.fit_score + \')\');
        }
        return \'You are a ServiceNow Technical Architect. Generate a Low-Level Design (LLD) document in Markdown. \' +
            \'Include: Table Design & Schema Changes, Script Includes, Business Rules, UI Policies and Client Scripts, \' +
            \'Flow Designer Flows, REST API Integrations, ACLs and Security, Test Scenarios.\\n\\n\' +
            \'HLD Reference sys_id: \' + (ctx.hldSysId || \'N/A\') + \'\\n\\n\' +
            \'Confirmed Requirements:\\n\' + reqLines.join(\'\\n\') + \'\\n\\n\' +
            \'OOB Capability Mappings:\\n\' + (oobLines.length ? oobLines.join(\'\\n\') : \'None identified.\');
    },

    /**
     * Returns a minimal Markdown HLD string when AI is unavailable.
     * @param {Object} ctx
     * @returns {string}
     */
    _fallbackHLD: function(ctx) {
        var lines = [
            \'# High-Level Design\',
            \'\',
            \'## Executive Summary\',
            \'This document describes the high-level design for the SAGEBRUSH solution.\',
            \'\',
            \'## Solution Overview\',
            \'The solution addresses the following confirmed requirements.\',
            \'\',
            \'## Confirmed Requirements\',
        ];
        for (var i = 0; i < ctx.requirements.length; i++) {
            var req = ctx.requirements[i];
            lines.push((i + 1) + \'. [\' + (req.priority || \'medium\').toUpperCase() + \'] \' + req.requirement_text);
        }
        lines.push(\'\');
        lines.push(\'## OOB Capability Mappings\');
        if (ctx.oobMappings.length > 0) {
            for (var j = 0; j < ctx.oobMappings.length; j++) {
                var oob = ctx.oobMappings[j];
                lines.push(\'- \' + oob.feature + \' -> \' + oob.module);
            }
        } else {
            lines.push(\'No OOB mappings identified.\');
        }
        lines.push(\'\');
        lines.push(\'## Key Components\');
        lines.push(\'To be detailed in the Low-Level Design.\');
        lines.push(\'\');
        lines.push(\'## Integration Points\');
        lines.push(\'To be detailed in the Low-Level Design.\');
        lines.push(\'\');
        lines.push(\'## Estimated Scope\');
        lines.push(\'Scope to be determined based on detailed analysis.\');
        return lines.join(\'\\n\');
    },

    /**
     * Returns a minimal Markdown LLD string when AI is unavailable.
     * @param {Object} ctx
     * @returns {string}
     */
    _fallbackLLD: function(ctx) {
        var lines = [
            \'# Low-Level Design\',
            \'\',
            \'## Table Design & Schema Changes\',
            \'Custom tables: x_snc_sagebrush_session, x_snc_sagebrush_requirement, x_snc_sagebrush_oob_map.\',
            \'\',
            \'## Script Includes\',
            \'SAGEBRUSHDesignWriter, SAGEBRUSHAIProvider, SAGEBRUSHSessionManager, SAGEBRUSHRequirementExtractor.\',
            \'\',
            \'## Business Rules\',
            \'To be defined per requirement.\',
            \'\',
            \'## UI Policies and Client Scripts\',
            \'To be defined per requirement.\',
            \'\',
            \'## Flow Designer Flows\',
            \'To be defined per integration requirement.\',
            \'\',
            \'## REST API Integrations\',
            \'To be defined per integration requirement.\',
            \'\',
            \'## ACLs and Security\',
            \'Role-based access: x_snc_sagebrush.admin, x_snc_sagebrush.user.\',
            \'\',
            \'## Test Scenarios\',
            \'Based on confirmed requirements:\',
        ];
        for (var i = 0; i < ctx.requirements.length; i++) {
            var req = ctx.requirements[i];
            lines.push(\'- Verify: \' + req.requirement_text);
        }
        return lines.join(\'\\n\');
    },

    /**
     * Saves a KB article and returns its sys_id.
     * @param {string} title
     * @param {string} content
     * @param {string} parentSysId - category or knowledge base sys_id
     * @returns {string|null}
     */
    _saveKBArticle: function(title, content, parentSysId) {
        try {
            var kb = new GlideRecord(this.KB_TABLE);
            kb.initialize();
            kb.setValue(\'short_description\', title);
            kb.setValue(\'text\', content);
            kb.setValue(\'workflow_state\', \'draft\');
            kb.setValue(\'kb_knowledge_base\', gs.getProperty(\'x_snc_sagebrush.kb.knowledge_base_sys_id\', \'\'));
            if (parentSysId) {
                kb.setValue(\'kb_category\', parentSysId);
            }
            kb.setValue(\'source\', \'x_snc_sagebrush\');
            var sysId = kb.insert();
            return sysId || null;
        } catch (e) {
            this.log.error(\'_saveKBArticle failed: \' + e.message);
            return null;
        }
    },

    /**
     * Gets or creates the SAGEBRUSH KB category and returns its sys_id.
     * @returns {string|null}
     */
    _getOrCreateCategory: function() {
        try {
            var cat = new GlideRecord(\'kb_category\');
            cat.addQuery(\'label\', \'SAGEBRUSH\');
            cat.query();
            if (cat.next()) {
                return cat.getValue(\'sys_id\');
            }
            // Create it
            var newCat = new GlideRecord(\'kb_category\');
            newCat.initialize();
            newCat.setValue(\'label\', \'SAGEBRUSH\');
            newCat.setValue(\'kb_knowledge_base\', gs.getProperty(\'x_snc_sagebrush.kb.knowledge_base_sys_id\', \'\'));
            return newCat.insert() || null;
        } catch (e) {
            this.log.error(\'_getOrCreateCategory failed: \' + e.message);
            return null;
        }
    },

    /**
     * Links a KB article sys_id to a field on the session record.
     * @param {string} sessionId
     * @param {string} field
     * @param {string} articleSysId
     */
    _linkToSession: function(sessionId, field, articleSysId) {
        try {
            var session = new GlideRecord(this.SESSION_TABLE);
            if (!session.get(sessionId)) {
                this.log.warn(\'_linkToSession: session not found - \' + sessionId);
                return;
            }
            session.setValue(field, articleSysId);
            session.update();
        } catch (e) {
            this.log.error(\'_linkToSession failed: \' + e.message);
        }
    },

    type: \'SAGEBRUSHDesignWriter\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHDialogflowHandler', '/**
 * @name SAGEBRUSHDialogflowHandler
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 * @description Translates Dialogflow CX webhook payloads to ConversationHandler calls and formats responses.
 *              Acts as a thin transport adapter — all conversation logic remains in ConversationHandler.
 */
var SAGEBRUSHDialogflowHandler = Class.create();
SAGEBRUSHDialogflowHandler.prototype = {

    initialize: function(dependencies) {
        this.log         = new GSLog(\'x_snc_sagebrush.dialogflow\', \'SAGEBRUSHDialogflowHandler\');
        this.conversation = (dependencies && dependencies.conversation) || new SAGEBRUSHConversationHandler();
    },

    /**
     * Main entry point called by the IntegrationHub inbound webhook flow.
     * @param {string} requestBodyJson   - Raw JSON string of the Dialogflow CX webhook POST body
     * @param {string} incomingSecret    - Value from X-Webhook-Secret request header
     * @param {string} expectedSecret    - Value from x_snc_sagebrush.dialogflow.webhook_secret property (passed in by flow)
     * @returns {string} JSON string — Dialogflow CX webhook response
     */
    processRequest: function(requestBodyJson, incomingSecret, expectedSecret) {
        // Validate shared secret
        if (incomingSecret !== expectedSecret) {
            this.log.warn(\'processRequest: webhook secret mismatch — request rejected\');
            return this._errorResponse(\'I am unable to process this request. Please contact your administrator.\');
        }

        var body;
        try {
            body = JSON.parse(requestBodyJson);
        } catch (e) {
            this.log.error(\'processRequest: failed to parse request body — \' + e.message);
            return this._errorResponse(\'I received a malformed request and cannot continue.\');
        }

        var userText    = this._extractText(body);
        var sessionInfo = (body.sessionInfo) || {};
        var params      = (sessionInfo.parameters) || {};
        var dfSessionId = (sessionInfo.session) || \'\';
        var existingId  = params.sagebrush_session_id || \'\';

        // Determine ServiceNow user — use integration user as proxy for phone caller
        var userId = gs.getUserID();

        if (!existingId || existingId.length !== 32) {
            // New phone session — create SAGEBRUSH session
            var invResult   = this.conversation.handleInvocation(userId, \'phone\');
            var newSessionId = invResult.sessionId;
            var greeting     = invResult.greeting;
            return this._successResponse(greeting, newSessionId);
        }

        // Existing session — route message through handler
        var msgResult = this.conversation.handleMessage(existingId, userText);
        return this._successResponse(msgResult.response, existingId);
    },

    _extractText: function(body) {
        // Dialogflow CX sends user utterance in body.text (top-level) or body.messages[0].text.text[0]
        if (body.text && body.text.length > 0) { return body.text; }
        try {
            var msgs = body.messages || [];
            if (msgs.length > 0 && msgs[0].text && msgs[0].text.text && msgs[0].text.text.length > 0) {
                return msgs[0].text.text[0];
            }
        } catch (e) { /* ignore */ }
        return \'\';
    },

    _successResponse: function(responseText, sagebrushSessionId) {
        return JSON.stringify({
            fulfillment_response: {
                messages: [
                    { text: { text: [responseText] } }
                ]
            },
            session_info: {
                parameters: {
                    sagebrush_session_id: sagebrushSessionId
                }
            }
        });
    },

    _errorResponse: function(message) {
        return JSON.stringify({
            fulfillment_response: {
                messages: [
                    { text: { text: [message] } }
                ]
            },
            session_info: { parameters: {} }
        });
    },

    type: \'SAGEBRUSHDialogflowHandler\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHInstanceScanner', '/**
 * @name SAGEBRUSHInstanceScanner
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHInstanceScanner = Class.create();
SAGEBRUSHInstanceScanner.prototype = {

    SNAPSHOT_TABLE: \'x_snc_sagebrush_instance_snapshot\',

    initialize: function(dependencies) {
        this.log     = new GSLog(\'x_snc_sagebrush.scanner\', \'SAGEBRUSHInstanceScanner\');
        this.auditor = (dependencies && dependencies.auditor) || new SAGEBRUSHAuditLogger();
        this.roles   = (dependencies && dependencies.roles)   || new SAGEBRUSHRoleHelper();
    },

    /**
     * Scans the instance across all accessible domains and stores a snapshot.
     * @param {string} sessionId
     * @returns {string} sys_id of snapshot record
     */
    scan: function(sessionId) {
        var start = new GlideDateTime().getNumericValue();
        this.log.info(\'Starting instance scan for session: \' + sessionId);

        var snapshot = {};
        snapshot.scanned_at  = new GlideDateTime().getDisplayValue();
        snapshot.plugins     = this._scanPlugins();
        snapshot.scopes      = this._scanScopes();
        snapshot.itsm        = this._scanITSM();
        snapshot.itom        = this._scanITOM();
        snapshot.grc         = this._scanGRC();
        snapshot.bcm         = this._scanBCM();
        snapshot.csm         = this._scanCSM();
        snapshot.hrsd        = this._scanHRSD();
        snapshot.integrations = this._scanIntegrations();
        snapshot.nowassist   = this._scanNowAssist();

        var duration = new GlideDateTime().getNumericValue() - start;

        var gr = new GlideRecord(this.SNAPSHOT_TABLE);
        gr.initialize();
        gr.setValue(\'session\', sessionId);
        gr.setValue(\'snapshot_json\', JSON.stringify(snapshot));
        gr.setValue(\'domains_scanned\', \'itsm,itom,grc,bcm,csm,hrsd,foundational\');
        gr.setValue(\'plugin_count\', snapshot.plugins.length);
        gr.setValue(\'app_count\', snapshot.scopes.custom_apps ? snapshot.scopes.custom_apps.length : 0);
        gr.setValue(\'scan_duration_ms\', duration);
        var sysId = gr.insert();

        this.auditor.log(\'instance_scan\', \'Instance scan complete. Plugins: \' + snapshot.plugins.length + \', Custom apps: \' + (snapshot.scopes.custom_apps || []).length, { sessionSysId: sessionId });
        return sysId;
    },

    /**
     * Retrieves and parses the most recent snapshot for a session.
     * @param {string} sessionId
     * @returns {Object|null}
     */
    getSnapshot: function(sessionId) {
        try {
            var gr = new GlideRecord(this.SNAPSHOT_TABLE);
            gr.addQuery(\'session\', sessionId);
            gr.orderByDesc(\'sys_created_on\');
            gr.setLimit(1);
            gr.query();
            if (!gr.next()) { return null; }
            return JSON.parse(gr.getValue(\'snapshot_json\') || \'{}\');
        } catch (e) {
            this.log.error(\'getSnapshot failed: \' + e.message);
            return null;
        }
    },

    _scanPlugins: function() {
        var plugins = [];
        try {
            var gr = new GlideRecord(\'v_plugin\');
            gr.addQuery(\'active\', true);
            gr.query();
            while (gr.next()) {
                plugins.push({ id: gr.getValue(\'source\'), name: gr.getValue(\'name\') });
            }
        } catch (e) { this.log.warn(\'Plugin scan failed: \' + e.message); }
        return plugins;
    },

    _scanScopes: function() {
        var result = { custom_apps: [] };
        try {
            var gr = new GlideRecord(\'sys_scope\');
            gr.addQuery(\'scope\', \'DOES NOT CONTAIN\', \'sn_\');
            gr.addQuery(\'scope\', \'DOES NOT CONTAIN\', \'com.snc\');
            gr.addQuery(\'scope\', \'!=\', \'global\');
            gr.addQuery(\'scope\', \'!=\', \'x_snc_sagebrush\');
            gr.addQuery(\'active\', true);
            gr.query();
            while (gr.next()) {
                result.custom_apps.push({
                    scope: gr.getValue(\'scope\'),
                    name:  gr.getValue(\'name\'),
                    version: gr.getValue(\'version\')
                });
            }
        } catch (e) { this.log.warn(\'Scope scan failed: \' + e.message); }
        return result;
    },

    _scanITSM: function() {
        var result = {};
        try {
            var inc = new GlideRecord(\'incident\');
            inc.addQuery(\'active\', true);
            inc.setLimit(1);
            inc.query();
            result.incident_active = inc.next();

            var flowAgg = new GlideAggregate(\'sys_hub_flow\');
            flowAgg.addQuery(\'active\', true);
            flowAgg.addAggregate(\'COUNT\');
            flowAgg.query();
            result.active_flows = flowAgg.next() ? parseInt(flowAgg.getAggregate(\'COUNT\'), 10) : 0;

            var brAgg = new GlideAggregate(\'sys_script\');
            brAgg.addQuery(\'active\', true);
            brAgg.addQuery(\'name\', \'CONTAINS\', \'incident\');
            brAgg.addAggregate(\'COUNT\');
            brAgg.query();
            result.incident_business_rules = brAgg.next() ? parseInt(brAgg.getAggregate(\'COUNT\'), 10) : 0;
        } catch (e) { this.log.warn(\'ITSM scan failed: \' + e.message); result.error = e.message; }
        return result;
    },

    _scanITOM: function() {
        var result = {};
        try {
            var ci = new GlideRecord(\'cmdb_ci\');
            ci.setLimit(1);
            ci.query();
            result.cmdb_active = true;

            // CRITICAL FIX: Use GlideAggregate instead of getRowCount() to avoid
            // performance issues with full table queries on large instances
            var agg = new GlideAggregate(\'cmdb_ci\');
            agg.addAggregate(\'COUNT\');
            agg.query();
            result.ci_count = agg.next() ? parseInt(agg.getAggregate(\'COUNT\'), 10) : 0;

            var disco = new GlideRecord(\'discovery_status\');
            disco.setLimit(1);
            disco.query();
            result.discovery_active = disco.next();
        } catch (e) { this.log.warn(\'ITOM scan failed: \' + e.message); result.error = e.message; }
        return result;
    },

    _scanGRC: function() {
        var result = {};
        try {
            var risk = new GlideRecord(\'sn_risk_risk\');
            risk.setLimit(1);
            risk.query();
            result.grc_active = risk.next();
            if (result.grc_active) {
                var riskAgg = new GlideAggregate(\'sn_risk_risk\');
                riskAgg.addAggregate(\'COUNT\');
                riskAgg.query();
                result.risk_count = riskAgg.next() ? parseInt(riskAgg.getAggregate(\'COUNT\'), 10) : 0;
            }
        } catch (e) { result.grc_active = false; result.error = \'GRC not installed: \' + e.message; }
        return result;
    },

    _scanBCM: function() {
        var result = {};
        try {
            var plan = new GlideRecord(\'sn_bcm_plan\');
            plan.setLimit(1);
            plan.query();
            result.bcm_active = plan.next();
        } catch (e) { result.bcm_active = false; result.error = \'BCM not installed: \' + e.message; }
        return result;
    },

    _scanCSM: function() {
        var result = {};
        try {
            var cas = new GlideRecord(\'sn_customerservice_case\');
            cas.setLimit(1);
            cas.query();
            result.csm_active = cas.next();
        } catch (e) { result.csm_active = false; result.error = \'CSM not installed: \' + e.message; }
        return result;
    },

    _scanHRSD: function() {
        var result = {};
        try {
            var hrCase = new GlideRecord(\'sn_hr_core_case\');
            hrCase.setLimit(1);
            hrCase.query();
            result.hrsd_active = hrCase.next();
        } catch (e) { result.hrsd_active = false; result.error = \'HRSD not installed: \' + e.message; }
        return result;
    },

    _scanIntegrations: function() {
        var result = { rest_messages: [], hub_connections: [] };
        try {
            var rest = new GlideRecord(\'sys_rest_message\');
            rest.addQuery(\'active\', true);
            rest.query();
            while (rest.next()) {
                result.rest_messages.push({ name: rest.getValue(\'name\'), endpoint: rest.getValue(\'rest_endpoint\') });
            }
        } catch (e) { this.log.warn(\'Integration scan failed: \' + e.message); }
        return result;
    },

    _scanNowAssist: function() {
        var result = {};
        try {
            var skillAgg = new GlideAggregate(\'sn_now_assist_skill\');
            skillAgg.addQuery(\'active\', true);
            skillAgg.addAggregate(\'COUNT\');
            skillAgg.query();
            result.skill_count = skillAgg.next() ? parseInt(skillAgg.getAggregate(\'COUNT\'), 10) : 0;
            var licensed = gs.getProperty(\'x_snc_sagebrush.ai.nowassist.licensed_domains\', \'itsm,csm,hrsd\');
            result.licensed_domains = licensed.split(\',\');
        } catch (e) { result.skill_count = 0; result.error = e.message; }
        return result;
    },

    type: \'SAGEBRUSHInstanceScanner\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHOOBMapper', '/**
 * @name SAGEBRUSHOOBMapper
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHOOBMapper = Class.create();
SAGEBRUSHOOBMapper.prototype = {

    REQ_TABLE: \'x_snc_sagebrush_requirement\',
    CAP_TABLE: \'x_snc_sagebrush_oob_capability\',
    MAP_TABLE: \'x_snc_sagebrush_oob_map\',

    initialize: function(dependencies) {
        this.log = new GSLog(\'x_snc_sagebrush.oob\', \'SAGEBRUSHOOBMapper\');
        this.ai  = (dependencies && dependencies.ai) || new SAGEBRUSHAIProvider();
    },

    /**
     * Maps all confirmed requirements in a session to OOB capabilities.
     * @param {string} sessionId
     * @param {string} snapshotSysId - optional, used for instance-aware mapping
     * @returns {Array} mapped results
     */
    mapSession: function(sessionId, snapshotSysId) {
        var reqs = this._getConfirmedRequirements(sessionId);
        var caps = this._getAllCapabilities();
        var results = [];

        for (var i = 0; i < reqs.length; i++) {
            var req = reqs[i];
            var mapping = this._mapRequirement(req, caps, sessionId);
            if (mapping) { results.push(mapping); }
        }
        return results;
    },

    /**
     * Builds a human-readable mapping summary with OOB recommendations.
     * @param {string} sessionId
     * @returns {string}
     */
    buildMappingSummary: function(sessionId) {
        var maps = new GlideRecord(this.MAP_TABLE);
        maps.addQuery(\'session\', sessionId);
        maps.query();

        var lines = [\'Here is how your requirements map to ServiceNow capabilities:\\n\'];
        while (maps.next()) {
            var reqGr = new GlideRecord(this.REQ_TABLE);
            reqGr.get(maps.getValue(\'requirement\'));
            var reqText = reqGr.getValue(\'requirement_text\');

            var capGr = new GlideRecord(this.CAP_TABLE);
            capGr.get(maps.getValue(\'capability\'));
            var capName = capGr.getValue(\'capability_name\');
            var level   = capGr.getValue(\'priority_level\');
            var tier    = capGr.getValue(\'license_tier\');
            var plugin  = capGr.getValue(\'plugin_id\');

            var levelLabel = [\'\', \'Core OOB (no config needed)\', \'Activatable Plugin\', \'Store App\', \'Flow Designer Config\', \'Custom Scoped App\'][level] || \'Unknown\';
            var line = \'- "\' + reqText + \'"\\n  → \' + capName + \' [\' + levelLabel + \', License: \' + tier + \']\';
            if (plugin) { line += \'\\n  → Plugin to activate: \' + plugin; }
            if (maps.getValue(\'custom_code\') === \'1\') { line += \'\\n  ⚠️ Requires custom development\'; }
            if (maps.getValue(\'config_needed\')) { line += \'\\n  Configuration: \' + maps.getValue(\'config_needed\'); }
            lines.push(line);
        }

        lines.push(\'\\nShall I proceed with this solution approach, or would you like to adjust?\');
        return lines.join(\'\\n\');
    },

    _mapRequirement: function(req, capabilities, sessionId) {
        // Step 1: keyword matching against OOB capability registry
        var reqText  = (req.requirement_text || \'\').toLowerCase();
        var bestCap  = null;
        var bestScore = 0;

        for (var i = 0; i < capabilities.length; i++) {
            var cap = capabilities[i];
            var score = this._keywordScore(reqText, cap.keywords);
            if (score > bestScore) { bestScore = score; bestCap = cap; }
        }

        // Step 2: If keyword match is weak (<30), ask AI for better mapping
        if (bestScore < 30 && capabilities.length > 0) {
            var capList = capabilities.map(function(c) { return c.capability_name + \': \' + c.description; }).join(\'\\n\');
            var prompt  = \'Match this requirement to the best ServiceNow OOB capability from the list below. \' +
                \'Respond with JSON: { "capability_name": "...", "config_needed": "...", "custom_code": false, "rationale": "..." }. \' +
                \'Requirement: "\' + req.requirement_text + \'"\\n\\nCapabilities:\\n\' + capList;
            var aiResult = this.ai.ask(prompt, {}, \'itsm\');
            if (aiResult.success) {
                try {
                    var jsonMatch = aiResult.text.match(/\\{[\\s\\S]*\\}/);
                    if (jsonMatch) {
                        var aiMap = JSON.parse(jsonMatch[0]);
                        for (var j = 0; j < capabilities.length; j++) {
                            if (capabilities[j].capability_name === aiMap.capability_name) {
                                bestCap = {
                                    sys_id:          capabilities[j].sys_id,
                                    capability_name: capabilities[j].capability_name,
                                    description:     capabilities[j].description,
                                    priority_level:  capabilities[j].priority_level,
                                    license_tier:    capabilities[j].license_tier,
                                    plugin_id:       capabilities[j].plugin_id,
                                    keywords:        capabilities[j].keywords,
                                    _ai_config:      aiMap.config_needed,
                                    _ai_custom:      aiMap.custom_code,
                                    _ai_rationale:   aiMap.rationale
                                };
                                bestScore = 60;
                                break;
                            }
                        }
                    }
                } catch (e) { this.log.warn(\'AI mapping parse failed: \' + e.message); }
            }
        }

        if (!bestCap) {
            // No match found — create a custom development entry
            bestCap = { sys_id: null, capability_name: \'Custom Scoped App Required\', priority_level: 5, license_tier: \'custom\' };
            bestScore = 0;
        }

        return this._saveMapping(sessionId, req.sys_id, bestCap, bestScore);
    },

    _keywordScore: function(reqText, keywords) {
        if (!keywords) { return 0; }
        var keyList = keywords.split(\',\');
        var matches = 0;
        for (var i = 0; i < keyList.length; i++) {
            if (reqText.indexOf(keyList[i].trim().toLowerCase()) !== -1) { matches++; }
        }
        return Math.min(100, Math.round((matches / Math.max(keyList.length, 1)) * 100));
    },

    _saveMapping: function(sessionId, reqSysId, cap, score) {
        var map = new GlideRecord(this.MAP_TABLE);
        map.initialize();
        map.setValue(\'session\', sessionId);
        map.setValue(\'requirement\', reqSysId);
        if (cap.sys_id) { map.setValue(\'capability\', cap.sys_id); }
        map.setValue(\'match_score\', score);
        map.setValue(\'config_needed\', cap._ai_config || \'\');
        map.setValue(\'custom_code\', cap._ai_custom || false);
        map.setValue(\'risk_level\', score < 50 ? \'high\' : (score < 75 ? \'medium\' : \'low\'));
        map.setValue(\'ai_rationale\', cap._ai_rationale || \'\');
        var mapSysId = map.insert();

        // Update requirement with OOB mapping reference
        var req = new GlideRecord(this.REQ_TABLE);
        if (req.get(reqSysId)) { req.setValue(\'oob_mapping\', mapSysId); req.update(); }

        return { capability_name: cap.capability_name, match_score: score, config_needed: cap._ai_config || cap.config_needed || \'\', custom_code: cap._ai_custom || false, requirement_sys_id: reqSysId };
    },

    _getConfirmedRequirements: function(sessionId) {
        var reqs = [];
        var gr = new GlideRecord(this.REQ_TABLE);
        gr.addQuery(\'session\', sessionId);
        gr.addQuery(\'confirmed\', true);
        gr.query();
        while (gr.next()) {
            reqs.push({ sys_id: gr.getValue(\'sys_id\'), requirement_text: gr.getValue(\'requirement_text\') });
        }
        return reqs;
    },

    _getAllCapabilities: function() {
        var caps = [];
        var gr = new GlideRecord(this.CAP_TABLE);
        gr.addQuery(\'active\', true);
        gr.orderBy(\'priority_level\');
        gr.query();
        while (gr.next()) {
            caps.push({
                sys_id:           gr.getValue(\'sys_id\'),
                capability_name:  gr.getValue(\'capability_name\'),
                description:      gr.getValue(\'description\'),
                priority_level:   parseInt(gr.getValue(\'priority_level\') || \'5\', 10),
                license_tier:     gr.getValue(\'license_tier\'),
                plugin_id:        gr.getValue(\'plugin_id\'),
                keywords:         gr.getValue(\'keywords\')
            });
        }
        return caps;
    },

    type: \'SAGEBRUSHOOBMapper\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHRequirementExtractor', '/**
 * @name SAGEBRUSHRequirementExtractor
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHRequirementExtractor = Class.create();
SAGEBRUSHRequirementExtractor.prototype = {

    REQ_TABLE: \'x_snc_sagebrush_requirement\',

    initialize: function(dependencies) {
        this.log = new GSLog(\'x_snc_sagebrush.requirements\', \'SAGEBRUSHRequirementExtractor\');
        this.ai  = (dependencies && dependencies.ai) || new SAGEBRUSHAIProvider();
    },

    /**
     * Extracts structured requirements from free text (voice transcript or chat).
     * @param {string} sessionId
     * @param {string} text - Raw user input
     * @param {string} source - voice | chat | document
     * @returns {Array} Array of { sys_id, requirement_text, type, priority }
     */
    extractFromText: function(sessionId, text, source) {
        var prompt = \'You are a ServiceNow Solution Architect. Extract structured requirements from the following user input. \' +
            \'Return a JSON array where each item has: requirement_text (string), requirement_type (functional|non_functional|integration|constraint), priority (high|medium|low). \' +
            \'Be specific and atomic — one requirement per item. User input: "\' + text + \'"\';

        var aiResult = this.ai.ask(prompt, { raw_text: text }, \'itsm\');

        var requirements = [];
        if (aiResult.success) {
            try {
                // Extract JSON array from AI response
                var jsonMatch = aiResult.text.match(/\\[[\\s\\S]*\\]/);
                if (jsonMatch) {
                    requirements = JSON.parse(jsonMatch[0]);
                }
            } catch (e) {
                this.log.warn(\'Failed to parse AI requirements JSON, falling back to single requirement: \' + e.message);
                requirements = [{ requirement_text: text, requirement_type: \'functional\', priority: \'medium\' }];
            }
        } else {
            // Fallback: treat entire text as a single requirement
            requirements = [{ requirement_text: text, requirement_type: \'functional\', priority: \'medium\' }];
        }

        return this._saveRequirements(sessionId, requirements, source);
    },

    /**
     * Extracts requirements from a ServiceNow attachment (PDF/DOCX/TXT).
     * @param {string} sessionId
     * @param {string} attachmentSysId - sys_attachment sys_id
     * @returns {Array} Array of { sys_id, requirement_text, type, priority }
     */
    extractFromAttachment: function(sessionId, attachmentSysId) {
        try {
            // Use Document Intelligence API to extract text from attachment
            var docIntel = new sn_doc_services.DocumentIntelligenceAPI();
            var result = docIntel.extractText(attachmentSysId);
            var extractedText = result && result.text ? result.text : \'\';

            if (!extractedText || extractedText.length === 0) {
                this.log.warn(\'Document Intelligence returned empty text for attachment: \' + attachmentSysId);
                return [];
            }

            return this.extractFromText(sessionId, extractedText, \'document\');
        } catch (e) {
            this.log.error(\'extractFromAttachment failed: \' + e.message);
            // Fallback: read raw attachment content
            try {
                var sa = new GlideSysAttachment();
                var attRecord = new GlideRecord(\'sys_attachment\');
                attRecord.get(attachmentSysId);
                var rawText = sa.getContent(attRecord);
                return this.extractFromText(sessionId, rawText, \'document\');
            } catch (e2) {
                this.log.error(\'Raw attachment read also failed: \' + e2.message);
                return [];
            }
        }
    },

    /**
     * Builds a numbered playback summary for user confirmation.
     * @param {string} sessionId
     * @returns {string}
     */
    buildPlayback: function(sessionId) {
        var gr = new GlideRecord(this.REQ_TABLE);
        gr.addQuery(\'session\', sessionId);
        gr.orderBy(\'sequence\');
        gr.query();

        var lines = [\'Here\\\'s what I understood from what you shared:\'];
        var counter = 1;
        while (gr.next()) {
            var priority = gr.getValue(\'priority\') || \'medium\';
            lines.push(counter + \'. [\' + priority.toUpperCase() + \'] \' + gr.getValue(\'requirement_text\'));
            counter++;
        }

        if (counter === 1) {
            return \'I could not extract any requirements. Please describe what you want to achieve again.\';
        }

        lines.push(\'\');
        lines.push(\'Is that right? You can say "Add [something]", "Remove number [X]", or "That\\\'s correct" to confirm.\');
        return lines.join(\'\\n\');
    },

    /**
     * Marks a single requirement as confirmed.
     * @param {string} requirementSysId
     * @returns {Boolean}
     */
    confirmRequirement: function(requirementSysId) {
        try {
            var gr = new GlideRecord(this.REQ_TABLE);
            if (!gr.get(requirementSysId)) { return false; }
            gr.setValue(\'confirmed\', true);
            gr.update();
            return true;
        } catch (e) {
            this.log.error(\'confirmRequirement failed: \' + e.message);
            return false;
        }
    },

    /**
     * Marks all requirements in a session as confirmed.
     * @param {string} sessionId
     * @returns {Number} count of confirmed records
     */
    confirmAll: function(sessionId) {
        var gr = new GlideRecord(this.REQ_TABLE);
        gr.addQuery(\'session\', sessionId);
        gr.query();
        var count = 0;
        while (gr.next()) {
            gr.setValue(\'confirmed\', true);
            gr.update();
            count++;
        }
        return count;
    },

    /**
     * Adds a new requirement to a session.
     * @param {string} sessionId
     * @param {string} text
     * @returns {string} sys_id of new record
     */
    addRequirement: function(sessionId, text) {
        var gr = new GlideRecord(this.REQ_TABLE);
        gr.initialize();
        gr.setValue(\'session\', sessionId);
        gr.setValue(\'requirement_text\', text);
        gr.setValue(\'requirement_type\', \'functional\');
        gr.setValue(\'priority\', \'medium\');
        gr.setValue(\'source\', \'chat\');
        gr.setValue(\'confirmed\', false);
        gr.setValue(\'sequence\', this._nextSequence(sessionId));
        return gr.insert();
    },

    /**
     * Removes a requirement by sequence number.
     * @param {string} sessionId
     * @param {Number} sequenceNumber
     * @returns {Boolean}
     */
    removeBySequence: function(sessionId, sequenceNumber) {
        var gr = new GlideRecord(this.REQ_TABLE);
        gr.addQuery(\'session\', sessionId);
        gr.addQuery(\'sequence\', sequenceNumber);
        gr.query();
        if (gr.next()) {
            gr.deleteRecord();
            return true;
        }
        return false;
    },

    _saveRequirements: function(sessionId, requirements, source) {
        var saved = [];
        var baseSequence = this._nextSequence(sessionId);
        for (var i = 0; i < requirements.length; i++) {
            var req = requirements[i];
            var gr = new GlideRecord(this.REQ_TABLE);
            gr.initialize();
            gr.setValue(\'session\', sessionId);
            gr.setValue(\'requirement_text\', req.requirement_text || req.text || \'\');
            gr.setValue(\'requirement_type\', req.requirement_type || req.type || \'functional\');
            gr.setValue(\'priority\', req.priority || \'medium\');
            gr.setValue(\'source\', source || \'chat\');
            gr.setValue(\'confirmed\', false);
            gr.setValue(\'sequence\', baseSequence + i);
            var sysId = gr.insert();
            saved.push({ sys_id: sysId, requirement_text: req.requirement_text, type: req.requirement_type, priority: req.priority });
        }
        return saved;
    },

    _nextSequence: function(sessionId) {
        var gr = new GlideRecord(this.REQ_TABLE);
        gr.addQuery(\'session\', sessionId);
        gr.orderByDesc(\'sequence\');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) { return parseInt(gr.getValue(\'sequence\') || \'0\', 10) + 1; }
        return 1;
    },

    type: \'SAGEBRUSHRequirementExtractor\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHRoleHelper', '/**
 * @name SAGEBRUSHRoleHelper
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHRoleHelper = Class.create();
SAGEBRUSHRoleHelper.prototype = {

    DOMAIN_ROLES: {
        \'itsm\':        [\'itil\', \'x_snc_sagebrush.admin\', \'x_snc_sagebrush.architect\'],
        \'itom\':        [\'discovery_admin\', \'x_snc_sagebrush.architect\'],
        \'grc\':         [\'sn_grc.admin\', \'x_snc_sagebrush.architect\'],
        \'bcm\':         [\'sn_bcm.admin\', \'x_snc_sagebrush.architect\'],
        \'csm\':         [\'sn_customerservice.admin\', \'x_snc_sagebrush.architect\'],
        \'hrsd\':        [\'sn_hr_core.admin\', \'x_snc_sagebrush.architect\'],
        \'foundational\':[\'admin\', \'x_snc_sagebrush.architect\']
    },

    initialize: function() {
        this.log = new GSLog(\'x_snc_sagebrush.role\', \'SAGEBRUSHRoleHelper\');
    },

    /**
     * Returns the highest SAGEBRUSH role for a user.
     * @param {string} userId - sys_user sys_id (defaults to current user)
     * @returns {string} architect | admin | viewer | none
     */
    getUserRole: function(userId) {
        var uid = userId || gs.getUserID();
        if (this._userHasRole(uid, \'x_snc_sagebrush.architect\')) { return \'architect\'; }
        if (this._userHasRole(uid, \'x_snc_sagebrush.admin\'))     { return \'admin\'; }
        if (this._userHasRole(uid, \'x_snc_sagebrush.viewer\'))    { return \'viewer\'; }
        return \'none\';
    },

    /**
     * Checks if a user is entitled to access a specific domain.
     * @param {string} userId
     * @param {string} domain - itsm|itom|grc|bcm|csm|hrsd|foundational
     * @returns {Boolean}
     */
    canAccessDomain: function(userId, domain) {
        if (!domain) { return false; }
        var uid = userId || gs.getUserID();
        if (this._userHasRole(uid, \'x_snc_sagebrush.architect\')) { return true; }

        var domainRoles = this.DOMAIN_ROLES[domain.toLowerCase()];
        if (!domainRoles) { return false; }

        for (var i = 0; i < domainRoles.length; i++) {
            if (this._userHasRole(uid, domainRoles[i])) { return true; }
        }
        return false;
    },

    /**
     * Private helper: check if a user has a specific role.
     * @private
     * @param {string} uid - sys_user sys_id
     * @param {string} roleName - Role name to check
     * @returns {Boolean}
     */
    _userHasRole: function(uid, roleName) {
        if (uid === gs.getUserID()) {
            return gs.hasRole(roleName);
        }
        // For other users, query sys_user_has_role
        var userRole = new GlideRecord(\'sys_user_has_role\');
        userRole.addQuery(\'user\', uid);
        userRole.addQuery(\'role.name\', roleName);
        userRole.addQuery(\'state\', \'active\');
        userRole.setLimit(1);
        userRole.query();
        return userRole.next();
    },

    type: \'SAGEBRUSHRoleHelper\'
};
');

    (function createSI(name, script) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.query();
        if (gr.next()) {
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.update();
            gs.print('Updated: ' + name);
        } else {
            gr.initialize();
            gr.setValue('name', name);
            gr.setValue('api_name', 'x_snc_sagebrush.' + name);
            gr.setValue('script', script);
            gr.setValue('active', true);
            gr.setValue('access', 'public');
            gr.setValue('client_callable', false);
            gr.setValue('callers_access', 'caller_tracking');
            gr.insert();
            gs.print('Created: ' + name);
        }
    })('SAGEBRUSHSessionManager', '/**
 * @name SAGEBRUSHSessionManager
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHSessionManager = Class.create();
SAGEBRUSHSessionManager.prototype = {

    SESSION_TABLE: \'x_snc_sagebrush_session\',

    initialize: function() {
        this.log    = new GSLog(\'x_snc_sagebrush.session\', \'SAGEBRUSHSessionManager\');
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
            session.setValue(\'user_sys_id\', userId);
            session.setValue(\'channel\', channel);
            session.setValue(\'state\', \'active\');
            session.setValue(\'intent\', \'none\');
            session.setValue(\'short_description\', \'SAGEBRUSH Session - \' + new GlideDateTime().getDisplayValue());
            var sysId = session.insert();
            this.auditor.log(\'invoked\', \'Session created via \' + channel, { sessionSysId: sysId });
            return sysId;
        } catch (e) {
            this.log.error(\'createSession failed: \' + e.message);
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
                sys_id:       session.getValue(\'sys_id\'),
                channel:      session.getValue(\'channel\'),
                state:        session.getValue(\'state\'),
                intent:       session.getValue(\'intent\'),
                hld_article:  session.getValue(\'hld_article\'),
                lld_article:  session.getValue(\'lld_article\'),
                context_json: session.getValue(\'context_json\')
            };
        } catch (e) {
            this.log.error(\'getSession failed: \' + e.message);
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
            session.setValue(\'intent\', intent);
            var updateResult = session.update();
            return (updateResult !== null);
        } catch (e) {
            this.log.error(\'updateIntent failed: \' + e.message);
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
            session.setValue(\'state\', \'closed\');
            var updateResult = session.update();
            return (updateResult !== null);
        } catch (e) {
            this.log.error(\'closeSession failed: \' + e.message);
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
            session.setValue(\'context_json\', JSON.stringify(contextObj));
            var updateResult = session.update();
            return (updateResult !== null);
        } catch (e) {
            this.log.error(\'setContext failed: \' + e.message);
            return false;
        }
    },

    type: \'SAGEBRUSHSessionManager\'
};
');

    gs.print('SAGEBRUSH bootstrap complete');

})();
