# SAGEBRUSH Admin Guide

**Audience:** ServiceNow Administrators with `x_sagebrush.admin` role
**Short Description:** How to configure, monitor, and operate the SAGEBRUSH AI Agent

---

## 1. System Properties Reference

Navigate to: **System Properties → SAGEBRUSH**

| Property | Default | What It Does |
|----------|---------|--------------|
| x_sagebrush.ai.provider | nowassist | Primary AI: `nowassist`, `claude`, or `openai` |
| x_sagebrush.ai.fallback_provider | claude | Used when primary fails or domain unlicensed |
| x_sagebrush.ai.fallback_enabled | true | Set false to disable AI fallback entirely |
| x_sagebrush.ai.claude.api_key | (empty) | Anthropic API key — set before enabling Claude |
| x_sagebrush.ai.openai.api_key | (empty) | OpenAI API key — set before enabling OpenAI |
| x_sagebrush.ai.external.send_record_data | false | **NEVER set to true in production** |
| x_sagebrush.ai.nowassist.licensed_domains | itsm,csm,hrsd | Domains with Now Assist license |
| x_sagebrush.ai.timeout_ms | 30000 | AI call timeout before fallback fires (ms) |
| x_sagebrush.voice.provider | webspeech | `webspeech` or `dialogflow` |
| x_sagebrush.dialogflow.webhook_secret | (empty) | Must match Dialogflow webhook header |
| x_sagebrush.greeting.text | (greeting) | Edit the opening phrase SAGEBRUSH speaks |

---

## 2. Running Data Quality Scans

### Via SAGEBRUSH Chat
- Open Now Assist → type "SAGEBRUSH"
- Say: "Run a data quality check on ITSM" (or any domain)
- SAGEBRUSH runs the domain scan and reports the score

### Via Scheduled Flow
- Weekly full scan runs every Sunday at 02:00 (SAGEBRUSH_DQFullScan flow)
- To change schedule: Flow Designer → SAGEBRUSH_DQFullScan → Edit trigger

### Viewing Results
- Navigate to: **SAGEBRUSH → DQ Results** (x_sagebrush_dq_result table)
- PA Dashboard: **Performance Analytics → SAGEBRUSH Data Quality**
- Filter by severity, domain, or status

---

## 3. Remediation Workflow

1. Open a DQ result record
2. Click **Get Remediation Hint** — SAGEBRUSH generates role-appropriate guidance
3. Assign the record to the responsible group (Assigned To field)
4. Update Status to **Acknowledged** when under investigation
5. Update Status to **Remediated** when the underlying data is fixed
6. **Suppressed** = known exception, not an error

---

## 4. Monitoring

- **System Log** (filter: source = x_sagebrush.*) — all SAGEBRUSH activity
- **x_sagebrush_ai_log** — every AI call, provider used, token count, success/fail
- **x_sagebrush_audit_log** — every user session and invocation event
- DQ score trend visible on PA Dashboard — score below 70 warrants investigation

---

## 5. Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "No AI response" on all requests | API key missing or expired | Update x_sagebrush.ai.claude.api_key |
| Phone calls connect but no voice response | Dialogflow webhook secret mismatch | Match x_sagebrush.dialogflow.webhook_secret to Dialogflow console |
| DQ scan never completes | Large instance, CHUNK_SIZE limit | Check x_sagebrush_dq_run state — if running > 2hrs, check for flow errors |
| Score drops sharply | New DQ check seeded with broad query | Review x_sagebrush_dq_check — deactivate over-broad check if needed |
| "Cross-scope privilege denied" | Install Fix Script not run | Run SAGEBRUSH_Install.js as admin |
