/**
 * @name SAGEBRUSHInstanceScanner
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHInstanceScanner = Class.create();
SAGEBRUSHInstanceScanner.prototype = {

    SNAPSHOT_TABLE: 'x_snc_sagebrush_instance_snapshot',

    initialize: function(dependencies) {
        this.log     = new GSLog('x_snc_sagebrush.scanner', 'SAGEBRUSHInstanceScanner');
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
        this.log.info('Starting instance scan for session: ' + sessionId);

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
        gr.setValue('session', sessionId);
        gr.setValue('snapshot_json', JSON.stringify(snapshot));
        gr.setValue('domains_scanned', 'itsm,itom,grc,bcm,csm,hrsd,foundational');
        gr.setValue('plugin_count', snapshot.plugins.length);
        gr.setValue('app_count', snapshot.scopes.custom_apps ? snapshot.scopes.custom_apps.length : 0);
        gr.setValue('scan_duration_ms', duration);
        var sysId = gr.insert();

        this.auditor.log('instance_scan', 'Instance scan complete. Plugins: ' + snapshot.plugins.length + ', Custom apps: ' + (snapshot.scopes.custom_apps || []).length, { sessionSysId: sessionId });
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
            gr.addQuery('session', sessionId);
            gr.orderByDesc('sys_created_on');
            gr.setLimit(1);
            gr.query();
            if (!gr.next()) { return null; }
            return JSON.parse(gr.getValue('snapshot_json') || '{}');
        } catch (e) {
            this.log.error('getSnapshot failed: ' + e.message);
            return null;
        }
    },

    _scanPlugins: function() {
        var plugins = [];
        try {
            var gr = new GlideRecord('v_plugin');
            gr.addQuery('active', true);
            gr.query();
            while (gr.next()) {
                plugins.push({ id: gr.getValue('source'), name: gr.getValue('name') });
            }
        } catch (e) { this.log.warn('Plugin scan failed: ' + e.message); }
        return plugins;
    },

    _scanScopes: function() {
        var result = { custom_apps: [] };
        try {
            var gr = new GlideRecord('sys_scope');
            gr.addQuery('scope', 'DOES NOT CONTAIN', 'sn_');
            gr.addQuery('scope', 'DOES NOT CONTAIN', 'com.snc');
            gr.addQuery('scope', '!=', 'global');
            gr.addQuery('scope', '!=', 'x_snc_sagebrush');
            gr.addQuery('active', true);
            gr.query();
            while (gr.next()) {
                result.custom_apps.push({
                    scope: gr.getValue('scope'),
                    name:  gr.getValue('name'),
                    version: gr.getValue('version')
                });
            }
        } catch (e) { this.log.warn('Scope scan failed: ' + e.message); }
        return result;
    },

    _scanITSM: function() {
        var result = {};
        try {
            var inc = new GlideRecord('incident');
            inc.addQuery('active', true);
            inc.setLimit(1);
            inc.query();
            result.incident_active = inc.next();

            var flowAgg = new GlideAggregate('sys_hub_flow');
            flowAgg.addQuery('active', true);
            flowAgg.addAggregate('COUNT');
            flowAgg.query();
            result.active_flows = flowAgg.next() ? parseInt(flowAgg.getAggregate('COUNT'), 10) : 0;

            var brAgg = new GlideAggregate('sys_script');
            brAgg.addQuery('active', true);
            brAgg.addQuery('name', 'CONTAINS', 'incident');
            brAgg.addAggregate('COUNT');
            brAgg.query();
            result.incident_business_rules = brAgg.next() ? parseInt(brAgg.getAggregate('COUNT'), 10) : 0;
        } catch (e) { this.log.warn('ITSM scan failed: ' + e.message); result.error = e.message; }
        return result;
    },

    _scanITOM: function() {
        var result = {};
        try {
            var ci = new GlideRecord('cmdb_ci');
            ci.setLimit(1);
            ci.query();
            result.cmdb_active = true;

            // CRITICAL FIX: Use GlideAggregate instead of getRowCount() to avoid
            // performance issues with full table queries on large instances
            var agg = new GlideAggregate('cmdb_ci');
            agg.addAggregate('COUNT');
            agg.query();
            result.ci_count = agg.next() ? parseInt(agg.getAggregate('COUNT'), 10) : 0;

            var disco = new GlideRecord('discovery_status');
            disco.setLimit(1);
            disco.query();
            result.discovery_active = disco.next();
        } catch (e) { this.log.warn('ITOM scan failed: ' + e.message); result.error = e.message; }
        return result;
    },

    _scanGRC: function() {
        var result = {};
        try {
            var risk = new GlideRecord('sn_risk_risk');
            risk.setLimit(1);
            risk.query();
            result.grc_active = risk.next();
            if (result.grc_active) {
                var riskAgg = new GlideAggregate('sn_risk_risk');
                riskAgg.addAggregate('COUNT');
                riskAgg.query();
                result.risk_count = riskAgg.next() ? parseInt(riskAgg.getAggregate('COUNT'), 10) : 0;
            }
        } catch (e) { result.grc_active = false; result.error = 'GRC not installed: ' + e.message; }
        return result;
    },

    _scanBCM: function() {
        var result = {};
        try {
            var plan = new GlideRecord('sn_bcm_plan');
            plan.setLimit(1);
            plan.query();
            result.bcm_active = plan.next();
        } catch (e) { result.bcm_active = false; result.error = 'BCM not installed: ' + e.message; }
        return result;
    },

    _scanCSM: function() {
        var result = {};
        try {
            var cas = new GlideRecord('sn_customerservice_case');
            cas.setLimit(1);
            cas.query();
            result.csm_active = cas.next();
        } catch (e) { result.csm_active = false; result.error = 'CSM not installed: ' + e.message; }
        return result;
    },

    _scanHRSD: function() {
        var result = {};
        try {
            var hrCase = new GlideRecord('sn_hr_core_case');
            hrCase.setLimit(1);
            hrCase.query();
            result.hrsd_active = hrCase.next();
        } catch (e) { result.hrsd_active = false; result.error = 'HRSD not installed: ' + e.message; }
        return result;
    },

    _scanIntegrations: function() {
        var result = { rest_messages: [], hub_connections: [] };
        try {
            var rest = new GlideRecord('sys_rest_message');
            rest.addQuery('active', true);
            rest.query();
            while (rest.next()) {
                result.rest_messages.push({ name: rest.getValue('name'), endpoint: rest.getValue('rest_endpoint') });
            }
        } catch (e) { this.log.warn('Integration scan failed: ' + e.message); }
        return result;
    },

    _scanNowAssist: function() {
        var result = {};
        try {
            var skillAgg = new GlideAggregate('sn_now_assist_skill');
            skillAgg.addQuery('active', true);
            skillAgg.addAggregate('COUNT');
            skillAgg.query();
            result.skill_count = skillAgg.next() ? parseInt(skillAgg.getAggregate('COUNT'), 10) : 0;
            var licensed = gs.getProperty('x_snc_sagebrush.ai.nowassist.licensed_domains', 'itsm,csm,hrsd');
            result.licensed_domains = licensed.split(',');
        } catch (e) { result.skill_count = 0; result.error = e.message; }
        return result;
    },

    type: 'SAGEBRUSHInstanceScanner'
};
