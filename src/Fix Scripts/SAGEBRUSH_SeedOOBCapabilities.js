// Fix Script: SAGEBRUSH_SeedOOBCapabilities
// Seeds the OOB capability registry. Safe to re-run — skips existing records by name.

var capabilities = [
    // ITSM — Level 1 (Core Platform)
    { capability_name: 'Incident Management', module: 'ITSM', priority_level: 1, domain: 'itsm', license_tier: 'standard', tables_involved: 'incident,task_sla', keywords: 'incident,ticket,break fix,outage,p1,p2,priority', description: 'Full ITIL incident lifecycle OOB — log, categorise, assign, resolve, close.' },
    { capability_name: 'Problem Management', module: 'ITSM', priority_level: 1, domain: 'itsm', license_tier: 'standard', tables_involved: 'problem,problem_task', keywords: 'problem,root cause,known error,workaround,RCA', description: 'OOB problem record with root cause analysis and known error database.' },
    { capability_name: 'Change Management', module: 'ITSM', priority_level: 1, domain: 'itsm', license_tier: 'standard', tables_involved: 'change_request,change_task', keywords: 'change,CAB,RFC,normal change,emergency change,standard change', description: 'Full ITIL change lifecycle with CAB approvals, conflict calendar, and risk assessment.' },
    { capability_name: 'Service Catalog', module: 'ITSM', priority_level: 1, domain: 'itsm', license_tier: 'standard', tables_involved: 'sc_request,sc_req_item,sc_task', keywords: 'catalog,request,ordering,fulfillment,self service', description: 'Service catalog with request items, variables, and fulfillment workflows OOB.' },
    { capability_name: 'SLA Engine', module: 'ITSM', priority_level: 1, domain: 'itsm', license_tier: 'standard', tables_involved: 'contract_sla,task_sla', keywords: 'SLA,OLA,response time,resolution time,breach,pause resume', description: 'OOB SLA with pause/resume conditions, breach notifications, and retroactive calculation.' },
    { capability_name: 'Flow Designer Approvals', module: 'Platform', priority_level: 1, domain: 'platform', license_tier: 'standard', tables_involved: 'sysapproval_approver', keywords: 'approval,approve,reject,multi-level approval,parallel approval', description: 'Approval actions in Flow Designer — single, parallel, sequential, group approvals OOB.' },
    { capability_name: 'Notification Engine', module: 'Platform', priority_level: 1, domain: 'platform', license_tier: 'standard', tables_involved: 'sysevent_email_action', keywords: 'notification,email,alert,notify,subscription', description: 'OOB notification system with templates, subscriptions, and condition-based delivery.' },
    // ITOM — Level 1
    { capability_name: 'CMDB', module: 'ITOM', priority_level: 1, domain: 'itom', license_tier: 'standard', tables_involved: 'cmdb_ci,cmdb_rel_ci', keywords: 'CMDB,CI,configuration item,asset,infrastructure,relationship', description: 'Core CMDB with CI hierarchy, relationship types, and CSDM framework OOB.' },
    { capability_name: 'Discovery', module: 'ITOM', priority_level: 2, domain: 'itom', license_tier: 'pro', plugin_id: 'com.snc.discovery', tables_involved: 'discovery_status,cmdb_ci', keywords: 'discovery,scan,auto-populate,agentless,probe,sensor', description: 'Agentless network discovery populating CMDB. Requires Discovery plugin activation.' },
    { capability_name: 'Service Mapping', module: 'ITOM', priority_level: 2, domain: 'itom', license_tier: 'enterprise', plugin_id: 'com.snc.service-mapping', tables_involved: 'sa_node,sa_edge_service', keywords: 'service map,dependency,topology,application service', description: 'Top-down service mapping building application service topologies in CMDB.' },
    // GRC — Level 2
    { capability_name: 'GRC Risk Management', module: 'GRC', priority_level: 2, domain: 'grc', license_tier: 'enterprise', plugin_id: 'com.sn_risk', tables_involved: 'sn_risk_risk', keywords: 'risk,risk register,risk score,inherent risk,residual risk', description: 'Integrated risk register with scoring, appetite, and treatment plans.' },
    { capability_name: 'GRC Policy Management', module: 'GRC', priority_level: 2, domain: 'grc', license_tier: 'enterprise', plugin_id: 'com.sn_compliance', tables_involved: 'sn_compliance_policy,sn_compliance_control', keywords: 'policy,compliance,control,regulation,audit', description: 'Policy and control management with automated evidence collection.' },
    // BCM — Level 2
    { capability_name: 'Business Continuity Management', module: 'BCM', priority_level: 2, domain: 'bcm', license_tier: 'enterprise', plugin_id: 'com.sn_bcm', tables_involved: 'sn_bcm_plan,sn_bcm_exercise', keywords: 'BCM,continuity,BCP,disaster recovery,DR,exercise,BIA', description: 'Business continuity planning with BIA, plan authoring, and exercise tracking.' },
    // CSM — Level 1/2
    { capability_name: 'Customer Service Management', module: 'CSM', priority_level: 1, domain: 'csm', license_tier: 'standard', tables_involved: 'sn_customerservice_case,sn_customerservice_account', keywords: 'customer,case,CSM,account,contact,omnichannel', description: 'Full customer case lifecycle with account/contact management and omnichannel routing OOB.' },
    // HRSD — Level 2
    { capability_name: 'HR Service Delivery', module: 'HRSD', priority_level: 2, domain: 'hrsd', license_tier: 'standard', plugin_id: 'com.sn_hr_core', tables_involved: 'sn_hr_core_case,sn_hr_core_employee', keywords: 'HR,human resources,onboarding,offboarding,HR case,COE', description: 'HR case management with COE routing, lifecycle events, and document management.' },
    // Platform — Now Assist
    { capability_name: 'Now Assist GenAI', module: 'Now Assist', priority_level: 1, domain: 'platform', license_tier: 'pro', tables_involved: '', keywords: 'AI,GenAI,generative AI,summarise,classify,text to flow,now assist', description: 'Native GenAI — case summarisation, classification, text-to-flow, and skill authoring.' },
    { capability_name: 'Virtual Agent', module: 'Now Assist', priority_level: 1, domain: 'platform', license_tier: 'standard', tables_involved: 'va_topic_block', keywords: 'chatbot,virtual agent,NLU,conversational,deflect', description: 'Conversational AI with NLU, topic trees, live agent handoff, and channel integrations OOB.' },
    // Platform — IntegrationHub
    { capability_name: 'Microsoft Teams Spoke', module: 'IntegrationHub', priority_level: 2, domain: 'platform', license_tier: 'standard', plugin_id: 'com.snc.hub.team', tables_involved: '', keywords: 'teams,microsoft teams,notification,chat,collaboration', description: 'Send messages, create teams, and manage meetings via Flow Designer actions.' },
    { capability_name: 'Jira Spoke', module: 'IntegrationHub', priority_level: 2, domain: 'platform', license_tier: 'standard', plugin_id: 'com.snc.hub.jira', tables_involved: '', keywords: 'jira,atlassian,issue,ticket sync,devops', description: 'Bi-directional Jira issue sync via Flow Designer.' },
    { capability_name: 'Performance Analytics', module: 'Platform', priority_level: 1, domain: 'platform', license_tier: 'pro', tables_involved: 'pa_job,pa_widget', keywords: 'reporting,dashboard,KPI,metric,trend,analytics,PA', description: 'Real-time PA indicators with breakdowns, targets, and trend widgets OOB.' }
];

var inserted = 0;
var skipped = 0;

capabilities.forEach(function(cap) {
    var existing = new GlideRecord('x_snc_sagebrush_oob_capability');
    existing.addQuery('capability_name', cap.capability_name);
    existing.query();
    if (existing.next()) { skipped++; return; }

    var gr = new GlideRecord('x_snc_sagebrush_oob_capability');
    gr.initialize();
    for (var field in cap) {
        if (cap.hasOwnProperty(field)) { gr.setValue(field, cap[field]); }
    }
    gr.insert();
    inserted++;
});

var log = new GSLog('x_snc_sagebrush.fix', 'SAGEBRUSH_FixScript');
log.info('SAGEBRUSH OOB Capabilities: ' + inserted + ' inserted, ' + skipped + ' skipped.');
