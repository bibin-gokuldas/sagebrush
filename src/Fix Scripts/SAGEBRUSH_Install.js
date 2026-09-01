// Fix Script: SAGEBRUSH_ProvisionScopePrivileges
// Runs once at app install. Safe to re-run — checks before insert.
// Provisions sys_scope_privilege records for all cross-scope reads.

var SAGEBRUSH_APP_SCOPE = 'x_snc_sagebrush';

var privileges = [
    // Global scope — ITSM + Foundational tables
    { target_scope: 'global', operation: 'read', name: 'incident' },
    { target_scope: 'global', operation: 'read', name: 'problem' },
    { target_scope: 'global', operation: 'read', name: 'change_request' },
    { target_scope: 'global', operation: 'read', name: 'change_task' },
    { target_scope: 'global', operation: 'read', name: 'sc_request' },
    { target_scope: 'global', operation: 'read', name: 'sc_req_item' },
    { target_scope: 'global', operation: 'read', name: 'sc_task' },
    { target_scope: 'global', operation: 'read', name: 'task' },
    { target_scope: 'global', operation: 'read', name: 'task_sla' },
    { target_scope: 'global', operation: 'read', name: 'cmdb_ci' },
    { target_scope: 'global', operation: 'read', name: 'cmdb_rel_ci' },
    { target_scope: 'global', operation: 'read', name: 'cmdb_ci_service' },
    { target_scope: 'global', operation: 'read', name: 'sys_user' },
    { target_scope: 'global', operation: 'read', name: 'sys_user_group' },
    { target_scope: 'global', operation: 'read', name: 'sys_user_has_role' },
    { target_scope: 'global', operation: 'read', name: 'cmn_department' },
    { target_scope: 'global', operation: 'read', name: 'cmn_location' },
    { target_scope: 'global', operation: 'read', name: 'core_company' },
    { target_scope: 'global', operation: 'read', name: 'cmn_cost_center' },
    { target_scope: 'global', operation: 'read', name: 'sys_scope' },
    { target_scope: 'global', operation: 'read', name: 'v_plugin' },
    { target_scope: 'global', operation: 'read', name: 'kb_knowledge' },
    { target_scope: 'global', operation: 'write', name: 'kb_knowledge' },
    // HRSD scope
    { target_scope: 'sn_hr_core', operation: 'read', name: 'sn_hr_core_case' },
    { target_scope: 'sn_hr_core', operation: 'read', name: 'sn_hr_core_employee' },
    { target_scope: 'sn_hr_core', operation: 'read', name: 'sn_hr_core_department' },
    // GRC scope
    { target_scope: 'sn_grc', operation: 'read', name: 'sn_risk_risk' },
    { target_scope: 'sn_grc', operation: 'read', name: 'sn_compliance_policy' },
    { target_scope: 'sn_grc', operation: 'read', name: 'sn_compliance_control' },
    { target_scope: 'sn_grc', operation: 'read', name: 'sn_audit_engagement' },
    // CSM scope
    { target_scope: 'sn_customerservice', operation: 'read', name: 'sn_customerservice_case' },
    { target_scope: 'sn_customerservice', operation: 'read', name: 'sn_customerservice_account' },
    { target_scope: 'sn_customerservice', operation: 'read', name: 'sn_customerservice_contact' },
    // BCM scope
    { target_scope: 'sn_bcm', operation: 'read', name: 'sn_bcm_plan' },
    { target_scope: 'sn_bcm', operation: 'read', name: 'sn_bcm_exercise' },
    { target_scope: 'sn_bcm', operation: 'read', name: 'sn_bcm_impact_analysis' },
    // ITOM / Discovery scope
    { target_scope: 'sn_itom_discovery', operation: 'read', name: 'discovery_status' },
    { target_scope: 'sn_itom_discovery', operation: 'read', name: 'sa_node' },
    { target_scope: 'sn_itom_discovery', operation: 'read', name: 'sa_edge_service' }
];

var inserted = 0;
var skipped = 0;

privileges.forEach(function(p) {
    // Check if already exists — safe to re-run
    var existing = new GlideRecord('sys_scope_privilege');
    existing.addQuery('scope', SAGEBRUSH_APP_SCOPE);
    existing.addQuery('target_scope', p.target_scope);
    existing.addQuery('operation', p.operation);
    existing.addQuery('name', p.name);
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
    priv.setValue('name', p.name);
    priv.insert();
    inserted++;
});

var log = new GSLog('x_snc_sagebrush.fix', 'SAGEBRUSH_FixScript');
log.info('SAGEBRUSH Install: ' + inserted + ' scope privileges created, ' + skipped + ' already existed.');
