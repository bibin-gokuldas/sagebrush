/**
 * @callable_from_other_scopes true
 */
/**
 * @name SAGEBRUSHDesignWriter
 * @callable_from_other_scopes true
 * @access public
 * @scope x_sagebrush
 */
var SAGEBRUSHDesignWriter = Class.create();
SAGEBRUSHDesignWriter.prototype = {

    SESSION_TABLE: 'x_sagebrush_session',
    REQ_TABLE:     'x_sagebrush_requirement',
    OOB_TABLE:     'x_sagebrush_oob_map',
    KB_TABLE:      'kb_knowledge',

    initialize: function(dependencies) {
        this.log = new GSLog('x_sagebrush.writer', 'SAGEBRUSHDesignWriter');
        this.ai  = (dependencies && dependencies.ai)  || new SAGEBRUSHAIProvider();
        this.sm  = (dependencies && dependencies.sm)  || new SAGEBRUSHSessionManager();
    },

    /**
     * Generates a High-Level Design KB article for the given session.
     * @param {string} sessionId - x_sagebrush_session sys_id
     * @returns {string} sys_id of the created KB article, or null on failure
     */
    generateHLD: function(sessionId) {
        try {
            var ctx = this._buildDesignContext(sessionId);
            var prompt = this._buildHLDPrompt(ctx);
            var aiResult = this.ai.ask(prompt, { session_id: sessionId }, 'itsm');
            var content = (aiResult && aiResult.success && aiResult.text)
                ? aiResult.text
                : this._fallbackHLD(ctx);
            var title = 'SAGEBRUSH HLD - ' + new GlideDateTime().getDisplayValue();
            var categoryId = this._getOrCreateCategory();
            var articleSysId = this._saveKBArticle(title, content, categoryId);
            if (articleSysId) {
                this._linkToSession(sessionId, 'hld_article', articleSysId);
            }
            return articleSysId || null;
        } catch (e) {
            this.log.error('generateHLD failed: ' + e.message);
            return null;
        }
    },

    /**
     * Generates a Low-Level Design KB article for the given session.
     * @param {string} sessionId - x_sagebrush_session sys_id
     * @param {string} hldSysId  - sys_id of the previously generated HLD article
     * @returns {string} sys_id of the created KB article, or null on failure
     */
    generateLLD: function(sessionId, hldSysId) {
        try {
            var ctx = this._buildDesignContext(sessionId);
            ctx.hldSysId = hldSysId;
            var prompt = this._buildLLDPrompt(ctx);
            var aiResult = this.ai.ask(prompt, { session_id: sessionId, hld_sys_id: hldSysId }, 'itsm');
            var content = (aiResult && aiResult.success && aiResult.text)
                ? aiResult.text
                : this._fallbackLLD(ctx);
            var title = 'SAGEBRUSH LLD - ' + new GlideDateTime().getDisplayValue();
            var categoryId = this._getOrCreateCategory();
            var articleSysId = this._saveKBArticle(title, content, categoryId);
            if (articleSysId) {
                this._linkToSession(sessionId, 'lld_article', articleSysId);
            }
            return articleSysId || null;
        } catch (e) {
            this.log.error('generateLLD failed: ' + e.message);
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
        gr.addQuery('session', sessionId);
        gr.addQuery('confirmed', true);
        gr.orderBy('sequence');
        gr.query();
        while (gr.next()) {
            requirements.push({
                sys_id:           gr.getValue('sys_id'),
                requirement_text: gr.getValue('requirement_text'),
                requirement_type: gr.getValue('requirement_type'),
                priority:         gr.getValue('priority'),
                sequence:         parseInt(gr.getValue('sequence') || '0', 10)
            });
        }

        var oobMappings = [];
        var om = new GlideRecord(this.OOB_TABLE);
        om.addQuery('session', sessionId);
        om.query();
        while (om.next()) {
            oobMappings.push({
                sys_id:       om.getValue('sys_id'),
                feature:      om.getValue('feature'),
                module:       om.getValue('module'),
                fit_score:    om.getValue('fit_score'),
                rationale:    om.getValue('rationale')
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
            reqLines.push((i + 1) + '. [' + (req.priority || 'medium').toUpperCase() + '] ' + req.requirement_text);
        }
        var oobLines = [];
        for (var j = 0; j < ctx.oobMappings.length; j++) {
            var oob = ctx.oobMappings[j];
            oobLines.push('- ' + oob.feature + ' -> ' + oob.module + ' (fit: ' + oob.fit_score + ')');
        }
        return 'You are a ServiceNow Solution Architect. Generate a High-Level Design (HLD) document in Markdown. ' +
            'Include: Executive Summary, Solution Overview, Key Components, Integration Points, Data Flow, ' +
            'ServiceNow Modules Used, Estimated Scope.\n\n' +
            'Confirmed Requirements:\n' + reqLines.join('\n') + '\n\n' +
            'OOB Capability Mappings:\n' + (oobLines.length ? oobLines.join('\n') : 'None identified.');
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
            reqLines.push((i + 1) + '. [' + (req.priority || 'medium').toUpperCase() + '] ' + req.requirement_text);
        }
        var oobLines = [];
        for (var j = 0; j < ctx.oobMappings.length; j++) {
            var oob = ctx.oobMappings[j];
            oobLines.push('- ' + oob.feature + ' -> ' + oob.module + ' (fit: ' + oob.fit_score + ')');
        }
        return 'You are a ServiceNow Technical Architect. Generate a Low-Level Design (LLD) document in Markdown. ' +
            'Include: Table Design & Schema Changes, Script Includes, Business Rules, UI Policies and Client Scripts, ' +
            'Flow Designer Flows, REST API Integrations, ACLs and Security, Test Scenarios.\n\n' +
            'HLD Reference sys_id: ' + (ctx.hldSysId || 'N/A') + '\n\n' +
            'Confirmed Requirements:\n' + reqLines.join('\n') + '\n\n' +
            'OOB Capability Mappings:\n' + (oobLines.length ? oobLines.join('\n') : 'None identified.');
    },

    /**
     * Returns a minimal Markdown HLD string when AI is unavailable.
     * @param {Object} ctx
     * @returns {string}
     */
    _fallbackHLD: function(ctx) {
        var lines = [
            '# High-Level Design',
            '',
            '## Executive Summary',
            'This document describes the high-level design for the SAGEBRUSH solution.',
            '',
            '## Solution Overview',
            'The solution addresses the following confirmed requirements.',
            '',
            '## Confirmed Requirements',
        ];
        for (var i = 0; i < ctx.requirements.length; i++) {
            var req = ctx.requirements[i];
            lines.push((i + 1) + '. [' + (req.priority || 'medium').toUpperCase() + '] ' + req.requirement_text);
        }
        lines.push('');
        lines.push('## OOB Capability Mappings');
        if (ctx.oobMappings.length > 0) {
            for (var j = 0; j < ctx.oobMappings.length; j++) {
                var oob = ctx.oobMappings[j];
                lines.push('- ' + oob.feature + ' -> ' + oob.module);
            }
        } else {
            lines.push('No OOB mappings identified.');
        }
        lines.push('');
        lines.push('## Key Components');
        lines.push('To be detailed in the Low-Level Design.');
        lines.push('');
        lines.push('## Integration Points');
        lines.push('To be detailed in the Low-Level Design.');
        lines.push('');
        lines.push('## Estimated Scope');
        lines.push('Scope to be determined based on detailed analysis.');
        return lines.join('\n');
    },

    /**
     * Returns a minimal Markdown LLD string when AI is unavailable.
     * @param {Object} ctx
     * @returns {string}
     */
    _fallbackLLD: function(ctx) {
        var lines = [
            '# Low-Level Design',
            '',
            '## Table Design & Schema Changes',
            'Custom tables: x_sagebrush_session, x_sagebrush_requirement, x_sagebrush_oob_map.',
            '',
            '## Script Includes',
            'SAGEBRUSHDesignWriter, SAGEBRUSHAIProvider, SAGEBRUSHSessionManager, SAGEBRUSHRequirementExtractor.',
            '',
            '## Business Rules',
            'To be defined per requirement.',
            '',
            '## UI Policies and Client Scripts',
            'To be defined per requirement.',
            '',
            '## Flow Designer Flows',
            'To be defined per integration requirement.',
            '',
            '## REST API Integrations',
            'To be defined per integration requirement.',
            '',
            '## ACLs and Security',
            'Role-based access: x_sagebrush.admin, x_sagebrush.user.',
            '',
            '## Test Scenarios',
            'Based on confirmed requirements:',
        ];
        for (var i = 0; i < ctx.requirements.length; i++) {
            var req = ctx.requirements[i];
            lines.push('- Verify: ' + req.requirement_text);
        }
        return lines.join('\n');
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
            kb.setValue('short_description', title);
            kb.setValue('text', content);
            kb.setValue('workflow_state', 'draft');
            kb.setValue('kb_knowledge_base', gs.getProperty('x_sagebrush.kb.knowledge_base_sys_id', ''));
            if (parentSysId) {
                kb.setValue('kb_category', parentSysId);
            }
            kb.setValue('source', 'x_sagebrush');
            var sysId = kb.insert();
            return sysId || null;
        } catch (e) {
            this.log.error('_saveKBArticle failed: ' + e.message);
            return null;
        }
    },

    /**
     * Gets or creates the SAGEBRUSH KB category and returns its sys_id.
     * @returns {string|null}
     */
    _getOrCreateCategory: function() {
        try {
            var cat = new GlideRecord('kb_category');
            cat.addQuery('label', 'SAGEBRUSH');
            cat.query();
            if (cat.next()) {
                return cat.getValue('sys_id');
            }
            // Create it
            var newCat = new GlideRecord('kb_category');
            newCat.initialize();
            newCat.setValue('label', 'SAGEBRUSH');
            newCat.setValue('kb_knowledge_base', gs.getProperty('x_sagebrush.kb.knowledge_base_sys_id', ''));
            return newCat.insert() || null;
        } catch (e) {
            this.log.error('_getOrCreateCategory failed: ' + e.message);
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
                this.log.warn('_linkToSession: session not found - ' + sessionId);
                return;
            }
            session.setValue(field, articleSysId);
            session.update();
        } catch (e) {
            this.log.error('_linkToSession failed: ' + e.message);
        }
    },

    type: 'SAGEBRUSHDesignWriter'
};
