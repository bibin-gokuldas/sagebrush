// ATF Test: SAGEBRUSHAIProvider
// Test 1: provider_resolves_from_property
(function test_provider_resolves_from_property() {
    gs.setProperty('x_sagebrush.ai.provider', 'claude');
    gs.setProperty('x_sagebrush.ai.fallback_enabled', 'false');
    gs.setProperty('x_sagebrush.ai.claude.api_key', 'test-invalid-key');

    var provider = new SAGEBRUSHAIProvider();
    gs.assertTrue(provider.provider === 'claude', 'provider should read from property');
    gs.assertTrue(provider.fbEnabled === false, 'fallback should be disabled');

    // Restore
    gs.setProperty('x_sagebrush.ai.provider', 'nowassist');
    gs.setProperty('x_sagebrush.ai.fallback_enabled', 'true');
})();

// Test 2: unlicensed_domain_triggers_fallback
(function test_unlicensed_domain_triggers_fallback() {
    gs.setProperty('x_sagebrush.ai.provider', 'nowassist');
    gs.setProperty('x_sagebrush.ai.nowassist.licensed_domains', 'itsm,csm,hrsd');

    var provider = new SAGEBRUSHAIProvider();
    var isDomainLicensed = provider._isDomainLicensed('grc');
    gs.assertTrue(isDomainLicensed === false, 'GRC should not be licensed under nowassist');

    var isITSMLicensed = provider._isDomainLicensed('itsm');
    gs.assertTrue(isITSMLicensed === true, 'ITSM should be licensed');
})();

// Test 3: ask_returns_graceful_response_on_total_failure
(function test_ask_returns_graceful_response_on_total_failure() {
    gs.setProperty('x_sagebrush.ai.provider', 'claude');
    gs.setProperty('x_sagebrush.ai.fallback_provider', 'openai');
    gs.setProperty('x_sagebrush.ai.claude.api_key', '');
    gs.setProperty('x_sagebrush.ai.openai.api_key', '');

    var provider = new SAGEBRUSHAIProvider();
    var result = provider.ask('test prompt', {}, 'itsm');

    gs.assertTrue(typeof result === 'object', 'result must be an object');
    gs.assertTrue(result.hasOwnProperty('success'), 'result must have success property');
    gs.assertTrue(result.hasOwnProperty('text'), 'result must have text property');
    gs.assertTrue(typeof result.text === 'string', 'result.text must be a string');
    gs.assertTrue(result.success === false, 'success must be false on total failure');

    // Restore
    gs.setProperty('x_sagebrush.ai.provider', 'nowassist');
    gs.setProperty('x_sagebrush.ai.fallback_provider', 'claude');
})();
