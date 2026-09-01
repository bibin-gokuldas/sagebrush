/**
 * @name SAGEBRUSHDialogflowHandler
 * @callable_from_other_scopes true
 * @access public
 * @scope x_sagebrush
 * @description Translates Dialogflow CX webhook payloads to ConversationHandler calls and formats responses.
 *              Acts as a thin transport adapter — all conversation logic remains in ConversationHandler.
 */
var SAGEBRUSHDialogflowHandler = Class.create();
SAGEBRUSHDialogflowHandler.prototype = {

    initialize: function(dependencies) {
        this.log         = new GSLog('x_sagebrush.dialogflow', 'SAGEBRUSHDialogflowHandler');
        this.conversation = (dependencies && dependencies.conversation) || new SAGEBRUSHConversationHandler();
    },

    /**
     * Main entry point called by the IntegrationHub inbound webhook flow.
     * @param {string} requestBodyJson   - Raw JSON string of the Dialogflow CX webhook POST body
     * @param {string} incomingSecret    - Value from X-Webhook-Secret request header
     * @param {string} expectedSecret    - Value from x_sagebrush.dialogflow.webhook_secret property (passed in by flow)
     * @returns {string} JSON string — Dialogflow CX webhook response
     */
    processRequest: function(requestBodyJson, incomingSecret, expectedSecret) {
        // Validate shared secret
        if (incomingSecret !== expectedSecret) {
            this.log.warn('processRequest: webhook secret mismatch — request rejected');
            return this._errorResponse('I am unable to process this request. Please contact your administrator.');
        }

        var body;
        try {
            body = JSON.parse(requestBodyJson);
        } catch (e) {
            this.log.error('processRequest: failed to parse request body — ' + e.message);
            return this._errorResponse('I received a malformed request and cannot continue.');
        }

        var userText    = this._extractText(body);
        var sessionInfo = (body.sessionInfo) || {};
        var params      = (sessionInfo.parameters) || {};
        var dfSessionId = (sessionInfo.session) || '';
        var existingId  = params.sagebrush_session_id || '';

        // Determine ServiceNow user — use integration user as proxy for phone caller
        var userId = gs.getUserID();

        if (!existingId || existingId.length !== 32) {
            // New phone session — create SAGEBRUSH session
            var invResult   = this.conversation.handleInvocation(userId, 'phone');
            var newSessionId = invResult.sessionId;
            var greeting     = invResult.greeting;
            return this._successResponse(greeting, newSessionId);
        }

        // Existing session — route message through handler
        var msgResult = this.conversation.handleMessage(existingId, userText);
        return this._successResponse(msgResult.response, existingId);
    },

    _extractText: function(body) {
        // Dialogflow CX sends user utterance in body.text (top-level) or body.messages[0].text.text[0]
        if (body.text && body.text.length > 0) { return body.text; }
        try {
            var msgs = body.messages || [];
            if (msgs.length > 0 && msgs[0].text && msgs[0].text.text && msgs[0].text.text.length > 0) {
                return msgs[0].text.text[0];
            }
        } catch (e) { /* ignore */ }
        return '';
    },

    _successResponse: function(responseText, sagebrushSessionId) {
        return JSON.stringify({
            fulfillment_response: {
                messages: [
                    { text: { text: [responseText] } }
                ]
            },
            session_info: {
                parameters: {
                    sagebrush_session_id: sagebrushSessionId
                }
            }
        });
    },

    _errorResponse: function(message) {
        return JSON.stringify({
            fulfillment_response: {
                messages: [
                    { text: { text: [message] } }
                ]
            },
            session_info: { parameters: {} }
        });
    },

    type: 'SAGEBRUSHDialogflowHandler'
};
