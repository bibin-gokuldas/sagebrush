/**
 * @name SAGEBRUSHRequirementExtractor
 * @callable_from_other_scopes true
 * @access public
 * @scope x_sagebrush
 */
var SAGEBRUSHRequirementExtractor = Class.create();
SAGEBRUSHRequirementExtractor.prototype = {

    REQ_TABLE: 'x_sagebrush_requirement',

    initialize: function(dependencies) {
        this.log = new GSLog('x_sagebrush.requirements', 'SAGEBRUSHRequirementExtractor');
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
        var prompt = 'You are a ServiceNow Solution Architect. Extract structured requirements from the following user input. ' +
            'Return a JSON array where each item has: requirement_text (string), requirement_type (functional|non_functional|integration|constraint), priority (high|medium|low). ' +
            'Be specific and atomic — one requirement per item. User input: "' + text + '"';

        var aiResult = this.ai.ask(prompt, { raw_text: text }, 'itsm');

        var requirements = [];
        if (aiResult.success) {
            try {
                // Extract JSON array from AI response
                var jsonMatch = aiResult.text.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    requirements = JSON.parse(jsonMatch[0]);
                }
            } catch (e) {
                this.log.warn('Failed to parse AI requirements JSON, falling back to single requirement: ' + e.message);
                requirements = [{ requirement_text: text, requirement_type: 'functional', priority: 'medium' }];
            }
        } else {
            // Fallback: treat entire text as a single requirement
            requirements = [{ requirement_text: text, requirement_type: 'functional', priority: 'medium' }];
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
            var extractedText = result && result.text ? result.text : '';

            if (!extractedText || extractedText.length === 0) {
                this.log.warn('Document Intelligence returned empty text for attachment: ' + attachmentSysId);
                return [];
            }

            return this.extractFromText(sessionId, extractedText, 'document');
        } catch (e) {
            this.log.error('extractFromAttachment failed: ' + e.message);
            // Fallback: read raw attachment content
            try {
                var sa = new GlideSysAttachment();
                var attRecord = new GlideRecord('sys_attachment');
                attRecord.get(attachmentSysId);
                var rawText = sa.getContent(attRecord);
                return this.extractFromText(sessionId, rawText, 'document');
            } catch (e2) {
                this.log.error('Raw attachment read also failed: ' + e2.message);
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
        gr.addQuery('session', sessionId);
        gr.orderBy('sequence');
        gr.query();

        var lines = ['Here\'s what I understood from what you shared:'];
        var counter = 1;
        while (gr.next()) {
            var priority = gr.getValue('priority') || 'medium';
            lines.push(counter + '. [' + priority.toUpperCase() + '] ' + gr.getValue('requirement_text'));
            counter++;
        }

        if (counter === 1) {
            return 'I could not extract any requirements. Please describe what you want to achieve again.';
        }

        lines.push('');
        lines.push('Is that right? You can say "Add [something]", "Remove number [X]", or "That\'s correct" to confirm.');
        return lines.join('\n');
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
            gr.setValue('confirmed', true);
            gr.update();
            return true;
        } catch (e) {
            this.log.error('confirmRequirement failed: ' + e.message);
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
        gr.addQuery('session', sessionId);
        gr.query();
        var count = 0;
        while (gr.next()) {
            gr.setValue('confirmed', true);
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
        gr.setValue('session', sessionId);
        gr.setValue('requirement_text', text);
        gr.setValue('requirement_type', 'functional');
        gr.setValue('priority', 'medium');
        gr.setValue('source', 'chat');
        gr.setValue('confirmed', false);
        gr.setValue('sequence', this._nextSequence(sessionId));
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
        gr.addQuery('session', sessionId);
        gr.addQuery('sequence', sequenceNumber);
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
            gr.setValue('session', sessionId);
            gr.setValue('requirement_text', req.requirement_text || req.text || '');
            gr.setValue('requirement_type', req.requirement_type || req.type || 'functional');
            gr.setValue('priority', req.priority || 'medium');
            gr.setValue('source', source || 'chat');
            gr.setValue('confirmed', false);
            gr.setValue('sequence', baseSequence + i);
            var sysId = gr.insert();
            saved.push({ sys_id: sysId, requirement_text: req.requirement_text, type: req.requirement_type, priority: req.priority });
        }
        return saved;
    },

    _nextSequence: function(sessionId) {
        var gr = new GlideRecord(this.REQ_TABLE);
        gr.addQuery('session', sessionId);
        gr.orderByDesc('sequence');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) { return parseInt(gr.getValue('sequence') || '0', 10) + 1; }
        return 1;
    },

    type: 'SAGEBRUSHRequirementExtractor'
};
