# SAGEBRUSH Go-Live Runbook

**Owner:** SAGEBRUSH Implementation Lead
**Applies to:** Production instance promotion

---

## Pre-Go-Live Checklist (run in DEV first, then PRD)

### 1. Source Control Import
- [ ] In Studio → Import From Source Control → `https://github.com/bibin-gokuldas/sagebrush.git` → branch `main`
- [ ] Verify all Script Includes are active in x_sagebrush scope
- [ ] Verify all tables exist (navigate to x_sagebrush_session — confirm no 404)

### 2. Run Install Fix Script
- [ ] System Definition → Fix Scripts → **SAGEBRUSH_Install** → Run Fix Script
- [ ] Confirm System Log shows: "SAGEBRUSH install complete — X privileges created"

### 3. Seed Reference Data
- [ ] Run **SAGEBRUSH_SeedOOBCapabilities** Fix Script
- [ ] Run **SAGEBRUSH_SeedDQChecks** Fix Script
- [ ] Confirm: x_sagebrush_oob_capability has > 0 records
- [ ] Confirm: x_sagebrush_dq_check has 28 records

### 4. Configure System Properties
- [ ] Set `x_sagebrush.ai.claude.api_key` (or openai key)
- [ ] Set `x_sagebrush.ai.provider` = `nowassist` (or `claude` if Now Assist not licensed)
- [ ] Set `x_sagebrush.ai.nowassist.licensed_domains` = comma list per your license
- [ ] Confirm `x_sagebrush.ai.external.send_record_data` = `false`
- [ ] Set `x_sagebrush.dialogflow.webhook_secret` (if phone channel enabled)

### 5. Run Go-Live Checklist Script
- [ ] System Definition → Fix Scripts → **SAGEBRUSH_GoLiveChecklist** → Run Fix Script
- [ ] System Log must show: "ALL CHECKS PASSED"
- [ ] Resolve any FAIL items before proceeding

### 6. Assign Roles
- [ ] Assign `x_sagebrush.user` to all ServiceNow users
- [ ] Assign `x_sagebrush.admin` to ITSM/DQ administrators
- [ ] Assign `x_sagebrush.architect` to Solution Architects / Developers

### 7. Phone Channel (if applicable)
- [ ] Import Dialogflow CX agent from `src/Dialogflow/sagebrush-cx-agent.json`
- [ ] Configure webhook URL in Dialogflow CX console → sagebrush-webhook → URL = `https://<prod-instance>.service-now.com/api/x_sagebrush/dialogflow_webhook`
- [ ] Set X-Webhook-Secret header = value of `x_sagebrush.dialogflow.webhook_secret`
- [ ] Enable Phone Gateway in Dialogflow CX → obtain AU phone number
- [ ] Set `x_sagebrush.voice.provider` = `dialogflow`
- [ ] Test: call the number → say "SAGEBRUSH" → confirm greeting plays

### 8. ATF Verification
- [ ] ATF → Test Suites → **SAGEBRUSH_ATF_Suite** → Run
- [ ] All tests must PASS before sign-off

### 9. PA Dashboard
- [ ] Performance Analytics → Jobs → run SAGEBRUSH_DQScore_Overall indicator
- [ ] Verify dashboard populates with DQ score data

---

## Rollback Procedure

If a critical issue is found post-go-live:

1. Deactivate all x_sagebrush Script Includes (bulk update active=false)
2. Deactivate SAGEBRUSH Now Assist Skill record
3. Source control: revert to last stable commit and re-import
4. Re-run SAGEBRUSH_GoLiveChecklist to confirm stable state

---

## Support Contacts

- System Log filter: `source STARTSWITH x_sagebrush`
- AI call log: x_sagebrush_ai_log table
- Escalate issues to the SAGEBRUSH implementation team
