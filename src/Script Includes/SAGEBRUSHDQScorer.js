/**
 * @name SAGEBRUSHDQScorer
 * @callable_from_other_scopes true
 * @access public
 * @scope x_sagebrush
 */
var SAGEBRUSHDQScorer = Class.create();
SAGEBRUSHDQScorer.prototype = {

    RESULT_TABLE: 'x_sagebrush_dq_result',
    RUN_TABLE:    'x_sagebrush_dq_run',
    CHECK_TABLE:  'x_sagebrush_dq_check',

    SEVERITY_DEDUCTIONS: { critical: 10, high: 5, medium: 2, low: 1 },

    initialize: function() {
        this.log = new GSLog('x_sagebrush.dq.scorer', 'SAGEBRUSHDQScorer');
    },

    /**
     * Calculates DQ scores for a completed run.
     * @param {string} runSysId
     * @returns {Object} { overall: Number, by_domain: Object, by_dimension: Object }
     */
    scoreRun: function(runSysId) {
        var run = new GlideRecord(this.RUN_TABLE);
        if (!run.get(runSysId)) { return { overall: 0, by_domain: {}, by_dimension: {} }; }

        var checksRun = parseInt(run.getValue('checks_run') || '0', 10);
        if (checksRun === 0) { return { overall: 100, by_domain: {}, by_dimension: {} }; }

        var deduction = 0;
        deduction += parseInt(run.getValue('critical_count') || '0', 10) * this.SEVERITY_DEDUCTIONS.critical;
        deduction += parseInt(run.getValue('high_count')     || '0', 10) * this.SEVERITY_DEDUCTIONS.high;
        deduction += parseInt(run.getValue('medium_count')   || '0', 10) * this.SEVERITY_DEDUCTIONS.medium;
        deduction += parseInt(run.getValue('low_count')      || '0', 10) * this.SEVERITY_DEDUCTIONS.low;

        var overall = Math.max(0, Math.min(100, 100 - deduction));

        var byDomain    = this._scoreByDomain(runSysId);
        var byDimension = this._scoreByDimension(runSysId);

        // Update run record with computed score
        run.setValue('dq_score', overall);
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
        gr.addQuery('dq_run', runSysId);
        gr.addQuery('domain', domain);
        gr.query();

        while (gr.next()) {
            var sev = gr.getValue('severity') || 'low';
            deduction += this.SEVERITY_DEDUCTIONS[sev] || 1;
        }

        return Math.max(0, Math.min(100, 100 - deduction));
    },

    _scoreByDomain: function(runSysId) {
        var domains = ['foundational', 'itsm', 'itom', 'grc', 'bcm', 'csm', 'hrsd'];
        var scores  = {};
        for (var i = 0; i < domains.length; i++) {
            scores[domains[i]] = this.scoreDomain(runSysId, domains[i]);
        }
        return scores;
    },

    _scoreByDimension: function(runSysId) {
        var dimensions = ['completeness', 'accuracy', 'consistency', 'referential', 'staleness', 'duplicate', 'compliance'];
        var scores     = {};
        for (var i = 0; i < dimensions.length; i++) {
            var deduction = 0;
            var gr = new GlideRecord(this.RESULT_TABLE);
            gr.addQuery('dq_run', runSysId);
            gr.addQuery('dimension', dimensions[i]);
            gr.query();
            while (gr.next()) {
                deduction += this.SEVERITY_DEDUCTIONS[gr.getValue('severity')] || 1;
            }
            scores[dimensions[i]] = Math.max(0, Math.min(100, 100 - deduction));
        }
        return scores;
    },

    type: 'SAGEBRUSHDQScorer'
};
