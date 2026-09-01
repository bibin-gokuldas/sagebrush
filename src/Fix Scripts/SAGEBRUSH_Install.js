// Fix Script: SAGEBRUSH_ProvisionScopePrivileges
// Runs once at app install. Safe to re-run — checks before insert.
// Provisions sys_scope_privilege records for all cross-scope reads.

var SAGEBRUSH_APP_SCOPE = 'x_snc_sagebrush';

var privileges = [
    // Global scope — ITSM + Foundational tables
    { target_scope: 'global', operation: 'read', target_table: 'incident' },
    { target_scope: 'global', operation: 'read', target_table: 'problem' },
    { target_scope: 'global', operation: 'read', target_table: 'change_request' },
    { target_scope: 'global', operation: 'read', target_table: 'change_task' },
    { target_scope: 'global', operation: 'read', target_table: 'sc_request' },
    { target_scope: 'global', operation: 'read', target_table: 'sc_req_item' },
    { target_scope: 'global', operation: 'read', target_table: 'sc_task' },
    { target_scope: 'global', operation: 'read', target_table: 'task' },
    { target_scope: 'global', operation: 'read', target_table: 'task_sla' },
    { target_scope: 'global', operation: 'read', target_table: 'cmdb_ci' },
    { target_scope: 'global', operation: 'read', target_table: 'cmdb_rel_ci' },
    { target_scope: 'global', operation: 'read', target_table: 'cmdb_ci_service' },
    { target_scope: 'global', operation: 'read', target_table: 'sys_user' },
    { target_scope: 'global', operation: 'read', target_table: 'sys_user_group' },
    { target_scope: 'global', operation: 'read', target_table: 'sys_user_has_role' },
    { target_scope: 'global', operation: 'read', target_table: 'cmn_department' },
    { target_scope: 'global', operation: 'read', target_table: 'cmn_location' },
    { target_scope: 'global', operation: 'read', target_table: 'core_company' },
    { target_scope: 'global', operation: 'read', target_table: 'cmn_cost_center' },
    { target_scope: 'global', operation: 'read', target_table: 'sys_scope' },
    { target_scope: 'global', operation: 'read', target_table: 'v_plugin' },
    { target_scope: 'global', operation: 'read', target_table: 'kb_knowledge' },
    { target_scope: 'global', operation: 'write', target_table: 'kb_knowledge' },
    // HRSD scope
    { target_scope: 'sn_hr_core', operation: 'read', target_table: 'sn_hr_core_case' },
    { target_scope: 'sn_hr_core', operation: 'read', target_table: 'sn_hr_core_employee' },
    { target_scope: 'sn_hr_core', operation: 'read', target_table: 'sn_hr_core_department' },
    // GRC scope
    { target_scope: 'sn_grc', operation: 'read', target_table: 'sn_risk_risk' },
    { target_scope: 'sn_grc', operation: 'read', target_table: 'sn_compliance_policy' },
    { target_scope: 'sn_grc', operation: 'read', target_table: 'sn_compliance_control' },
    { target_scope: 'sn_grc', operation: 'read', target_table: 'sn_audit_engagement' },
    // CSM scope
    { target_scope: 'sn_customerservice', operation: 'read', target_table: 'sn_customerservice_case' },
    { target_scope: 'sn_customerservice', operation: 'read', target_table: 'sn_customerservice_account' },
    { target_scope: 'sn_customerservice', operation: 'read', target_table: 'sn_customerservice_contact' },
    // BCM scope
    { target_scope: 'sn_bcm', operation: 'read', target_table: 'sn_bcm_plan' },
    { target_scope: 'sn_bcm', operation: 'read', target_table: 'sn_bcm_exercise' },
    { target_scope: 'sn_bcm', operation: 'read', target_table: 'sn_bcm_impact_analysis' },
    // ITOM / Discovery scope
    { target_scope: 'sn_itom_discovery', operation: 'read', target_table: 'discovery_status' },
    { target_scope: 'sn_itom_discovery', operation: 'read', target_table: 'sa_node' },
    { target_scope: 'sn_itom_discovery', operation: 'read', target_table: 'sa_edge_service' }
];

var inserted = 0;
var skipped = 0;

privileges.forEach(function(p) {
    // Check if already exists — safe to re-run
    var existing = new GlideRecord('sys_scope_privilege');
    existing.addQuery('scope', SAGEBRUSH_APP_SCOPE);
    existing.addQuery('target_scope', p.target_scope);
    existing.addQuery('operation', p.operation);
    existing.addQuery('target_table', p.target_table);
    existing.query();

    if (existing.next()) {
        skipped++;
        return;
    }

    var priv = new GlideRecord('sys_scope_privilege');
    priv.initialize();
    priv.setValue('scope', SAGEBRUSH_APP_SCOPE);
    priv.setValue('target_scope', p.target_scope);
    priv.setValue('operation', p.operation);
    priv.setValue('target_table', p.target_table);
    priv.insert();
    inserted++;
});

var log = new GSLog('x_snc_sagebrush.fix', 'SAGEBRUSH_FixScript');
log.info('SAGEBRUSH Install: ' + inserted + ' scope privileges created, ' + skipped + ' already existed.');
