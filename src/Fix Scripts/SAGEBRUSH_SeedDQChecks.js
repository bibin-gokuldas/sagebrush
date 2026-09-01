// Fix Script: SAGEBRUSH_SeedDQChecks
// Seeds all DQ check definitions. Safe to re-run — skips by check_name.

var checks = [
    // FOUNDATIONAL — Completeness
    { check_name: 'User missing Department', domain: 'foundational', dimension: 'completeness', severity: 'high', target_table: 'sys_user', check_query: 'active=true^departmentISEMPTY', message_template: 'User {record} has no department assigned.' },
    { check_name: 'User missing Manager', domain: 'foundational', dimension: 'completeness', severity: 'medium', target_table: 'sys_user', check_query: 'active=true^managerISEMPTY', message_template: 'User {record} has no manager assigned.' },
    { check_name: 'Department missing Cost Center', domain: 'foundational', dimension: 'completeness', severity: 'medium', target_table: 'cmn_department', check_query: 'cost_centerISEMPTY', message_template: 'Department {record} has no cost center.' },
    { check_name: 'Location missing Country', domain: 'foundational', dimension: 'completeness', severity: 'medium', target_table: 'cmn_location', check_query: 'countryISEMPTY', message_template: 'Location {record} has no country set.' },
    // FOUNDATIONAL — Duplicates
    { check_name: 'Duplicate User by Email', domain: 'foundational', dimension: 'duplicate', severity: 'high', target_table: 'sys_user', check_type: 'script', check_script: 'return SB_DQ_findDuplicates("sys_user", "email", "active=true");', message_template: 'Duplicate user records found with email {value}.' },
    { check_name: 'Duplicate Department Names', domain: 'foundational', dimension: 'duplicate', severity: 'medium', target_table: 'cmn_department', check_type: 'script', check_script: 'return SB_DQ_findDuplicates("cmn_department", "name", "");', message_template: 'Duplicate department name {value} found.' },
    // ITSM — Completeness
    { check_name: 'Incident missing Assignment Group', domain: 'itsm', dimension: 'completeness', severity: 'high', target_table: 'incident', check_query: 'active=true^assignment_groupISEMPTY^state!=7', message_template: 'Incident {record} has no assignment group.' },
    { check_name: 'Incident missing Category', domain: 'itsm', dimension: 'completeness', severity: 'medium', target_table: 'incident', check_query: 'active=true^categoryISEMPTY', message_template: 'Incident {record} has no category.' },
    { check_name: 'Problem missing Root Cause', domain: 'itsm', dimension: 'completeness', severity: 'high', target_table: 'problem', check_query: 'state=107^cause_notesISEMPTY', message_template: 'Problem {record} is resolved but has no root cause documented.' },
    { check_name: 'Change missing CAB Approval', domain: 'itsm', dimension: 'accuracy', severity: 'high', target_table: 'change_request', check_type: 'script', check_script: 'return SB_DQ_changesWithoutCAB();', message_template: 'Normal change {record} has no CAB approval record.' },
    // ITSM — Accuracy
    { check_name: 'P1 Incident without SLA', domain: 'itsm', dimension: 'accuracy', severity: 'critical', target_table: 'incident', check_type: 'script', check_script: 'return SB_DQ_p1IncidentsWithoutSLA();', message_template: 'P1 Incident {record} has no active SLA attached.' },
    { check_name: 'Incident assigned to inactive User', domain: 'itsm', dimension: 'referential', severity: 'high', target_table: 'incident', check_query: 'active=true^assigned_to.active=false^assigned_toISNOTEMPTY', message_template: 'Incident {record} is assigned to inactive user {field:assigned_to}.' },
    // ITSM — Staleness
    { check_name: 'Open P2 untouched 7 days', domain: 'itsm', dimension: 'staleness', severity: 'high', target_table: 'incident', check_query: 'priority=2^stateIN1,2^sys_updated_on<javascript:gs.daysAgoStart(7)', message_template: 'P2 Incident {record} has not been updated in 7+ days.' },
    { check_name: 'Open P1 untouched 4 hours', domain: 'itsm', dimension: 'staleness', severity: 'critical', target_table: 'incident', check_query: 'priority=1^stateIN1,2^sys_updated_on<javascript:gs.hoursAgoStart(4)', message_template: 'P1 Incident {record} has not been updated in 4+ hours.' },
    // ITOM — CMDB
    { check_name: 'CI missing Owner', domain: 'itom', dimension: 'completeness', severity: 'medium', target_table: 'cmdb_ci', check_query: 'install_status=1^owned_byISEMPTY', message_template: 'CI {record} has no owner assigned.' },
    { check_name: 'CI not discovered 90 days', domain: 'itom', dimension: 'staleness', severity: 'high', target_table: 'cmdb_ci', check_query: 'install_status=1^last_discovered<javascript:gs.daysAgoStart(90)', message_template: 'CI {record} has not been discovered in 90+ days — data may be stale.' },
    { check_name: 'Broken CI Relationship', domain: 'itom', dimension: 'referential', severity: 'critical', target_table: 'cmdb_rel_ci', check_type: 'script', check_script: 'return SB_DQ_brokenCIRelationships();', message_template: 'CI Relationship {record} references a deleted CI.' },
    // GRC — Compliance
    { check_name: 'Risk without Control', domain: 'grc', dimension: 'compliance', severity: 'critical', target_table: 'sn_risk_risk', check_type: 'script', check_script: 'return SB_DQ_risksWithoutControls();', message_template: 'Risk {record} has no control mapped — immediate action required.' },
    { check_name: 'Control not tested 12 months', domain: 'grc', dimension: 'staleness', severity: 'high', target_table: 'sn_compliance_control', check_query: 'last_tested_date<javascript:gs.daysAgoStart(365)', message_template: 'Control {record} has not been tested in over 12 months.' },
    { check_name: 'Risk not reviewed 6 months', domain: 'grc', dimension: 'staleness', severity: 'high', target_table: 'sn_risk_risk', check_query: 'last_reviewed_date<javascript:gs.daysAgoStart(180)', message_template: 'Risk {record} has not been reviewed in 6+ months.' },
    // BCM — Compliance
    { check_name: 'BCM Plan missing Owner', domain: 'bcm', dimension: 'completeness', severity: 'critical', target_table: 'sn_bcm_plan', check_query: 'owned_byISEMPTY^state!=3', message_template: 'BCM Plan {record} has no owner — business continuity risk.' },
    { check_name: 'BCM Plan not tested 12 months', domain: 'bcm', dimension: 'staleness', severity: 'critical', target_table: 'sn_bcm_plan', check_query: 'last_exercise_date<javascript:gs.daysAgoStart(365)', message_template: 'BCM Plan {record} has not been exercised in 12+ months.' },
    { check_name: 'BCM Exercise not completed 30 days', domain: 'bcm', dimension: 'staleness', severity: 'critical', target_table: 'sn_bcm_exercise', check_query: 'state=10^sys_created_on<javascript:gs.daysAgoStart(30)', message_template: 'BCM Exercise {record} has been in Planned state for 30+ days.' },
    // CSM — Completeness
    { check_name: 'CSM Case missing Account', domain: 'csm', dimension: 'completeness', severity: 'medium', target_table: 'sn_customerservice_case', check_query: 'active=true^accountISEMPTY', message_template: 'CSM Case {record} is not linked to an account.' },
    { check_name: 'CSM Case breached SLA', domain: 'csm', dimension: 'accuracy', severity: 'high', target_table: 'sn_customerservice_case', check_type: 'script', check_script: 'return SB_DQ_csmBreachedSLAs();', message_template: 'CSM Case {record} has a breached SLA.' },
    // HRSD — Completeness
    { check_name: 'HR Case missing HR Service', domain: 'hrsd', dimension: 'completeness', severity: 'medium', target_table: 'sn_hr_core_case', check_query: 'active=true^hr_serviceISEMPTY', message_template: 'HR Case {record} has no HR Service assigned.' },
    { check_name: 'Employee missing Department', domain: 'hrsd', dimension: 'completeness', severity: 'high', target_table: 'sn_hr_core_employee', check_query: 'active=true^departmentISEMPTY', message_template: 'HR Employee record {record} has no department.' },
    // ITSM — Consistency
    { check_name: 'User Location mismatch with CI', domain: 'foundational', dimension: 'consistency', severity: 'low', target_table: 'sys_user', check_type: 'script', check_script: 'return SB_DQ_locationConsistency();', message_template: 'User {record} location name format differs from CMDB CI location.' }
];

var inserted = 0, skipped = 0;
checks.forEach(function(c) {
    var existing = new GlideRecord('x_snc_sagebrush_dq_check');
    existing.addQuery('check_name', c.check_name);
    existing.query();
    if (existing.next()) { skipped++; return; }

    var gr = new GlideRecord('x_snc_sagebrush_dq_check');
    gr.initialize();
    for (var f in c) { if (c.hasOwnProperty(f)) { gr.setValue(f, c[f]); } }
    gr.setValue('check_type', c.check_type || 'query');
    gr.setValue('active', true);
    gr.insert();
    inserted++;
});
var log = new GSLog('x_snc_sagebrush.fix', 'SAGEBRUSH_SeedDQChecks');
log.info('SAGEBRUSH DQ Checks: ' + inserted + ' inserted, ' + skipped + ' skipped.');
