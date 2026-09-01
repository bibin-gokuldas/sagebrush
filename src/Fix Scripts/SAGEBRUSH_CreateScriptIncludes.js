/**
 * SAGEBRUSH — Create Script Includes from GitHub
 * Run in: Scripts - Background (as admin)
 *
 * Fetches each Script Include source from GitHub raw content and
 * creates/updates the sys_script_include record in this instance.
 * Requires outbound HTTP access to raw.githubusercontent.com.
 */
(function createSAGEBRUSHScriptIncludes() {

    var SCOPE_SYS_ID = '37abe07193074f10fb3a39018bba1060';
    var REPO_RAW     = 'https://raw.githubusercontent.com/bibin-gokuldas/sagebrush/main/src/Script%20Includes/';

    var SCRIPT_INCLUDES = [
        'SAGEBRUSHAIProvider',
        'SAGEBRUSHAuditLogger',
        'SAGEBRUSHConversationHandler',
        'SAGEBRUSHDataMasker',
        'SAGEBRUSHDesignWriter',
        'SAGEBRUSHDialogflowHandler',
        'SAGEBRUSHDQAIEngine',
        'SAGEBRUSHDQEngine',
        'SAGEBRUSHDQRemediator',
        'SAGEBRUSHDQRuleEngine',
        'SAGEBRUSHDQScorer',
        'SAGEBRUSHInstanceScanner',
        'SAGEBRUSHOOBMapper',
        'SAGEBRUSHRequirementExtractor',
        'SAGEBRUSHRoleHelper',
        'SAGEBRUSHSessionManager'
    ];

    var created = 0;
    var updated = 0;
    var failed  = 0;

    for (var i = 0; i < SCRIPT_INCLUDES.length; i++) {
        var name = SCRIPT_INCLUDES[i];
        var url  = REPO_RAW + name + '.js';

        gs.print('Fetching ' + name + '...');

        try {
            var req = new sn_ws.RESTMessageV2();
            req.setEndpoint(url);
            req.setHttpMethod('GET');
            req.setMutualAuth(false);
            var resp    = req.execute();
            var status  = resp.getStatusCode();
            var content = resp.getBody();

            if (status !== 200 || !content || content.length < 10) {
                gs.print('  FAILED fetch — HTTP ' + status);
                failed++;
                continue;
            }

            // Upsert the Script Include record
            var gr = new GlideRecord('sys_script_include');
            gr.addQuery('name', name);
            gr.addQuery('sys_scope', SCOPE_SYS_ID);
            gr.query();

            if (gr.next()) {
                gr.setValue('script', content);
                gr.setValue('active', true);
                gr.update();
                gs.print('  Updated ' + name);
                updated++;
            } else {
                gr.initialize();
                gr.setValue('name',           name);
                gr.setValue('api_name',       'x_snc_sagebrush.' + name);
                gr.setValue('script',         content);
                gr.setValue('active',         true);
                gr.setValue('access',         'public');
                gr.setValue('client_callable', false);
                gr.setValue('callers_access', 'caller_tracking');
                gr.setValue('sys_scope',      SCOPE_SYS_ID);
                gr.insert();
                gs.print('  Created ' + name);
                created++;
            }

        } catch (e) {
            gs.print('  ERROR ' + name + ': ' + e.message);
            failed++;
        }
    }

    gs.print('');
    gs.print('==============================================');
    gs.print('SAGEBRUSH Script Includes: ' + created + ' created, ' + updated + ' updated, ' + failed + ' failed');
    gs.print('==============================================');

})();
