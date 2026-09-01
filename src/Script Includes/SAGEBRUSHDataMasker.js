/**
 * @name SAGEBRUSHDataMasker
 * @callable_from_other_scopes true
 * @access public
 * @scope x_sagebrush
 */
var SAGEBRUSHDataMasker = Class.create();
SAGEBRUSHDataMasker.prototype = {

    PII_FIELDS: ['email', 'phone', 'mobile_phone', 'first_name', 'last_name',
                 'name', 'employee_id', 'user_name', 'password', 'sys_id'],

    initialize: function() {
        this.log = new GSLog('x_sagebrush.masker', 'SAGEBRUSHDataMasker');
    },

    /**
     * Masks PII fields in a data object before sending to external AI.
     * Non-PII fields are preserved. Numeric and boolean values are preserved.
     * @param {Object} dataObj - Plain JS object with fields to mask
     * @returns {Object} { maskedData: Object, tokenMap: Object }
     */
    mask: function(dataObj) {
        var maskedData = {};
        var tokenMap = {};
        var tokenCounter = 0;

        for (var key in dataObj) {
            if (!dataObj.hasOwnProperty(key)) {
                continue;
            }

            var value = dataObj[key];
            var isPII = this._isPIIField(key);

            if (isPII && typeof value === 'string' && value.length > 0) {
                tokenCounter++;
                var token = '[' + key.toUpperCase() + '_' + tokenCounter + ']';
                maskedData[key] = token;
                tokenMap[token] = value;
            } else {
                maskedData[key] = value;
            }
        }

        return { maskedData: maskedData, tokenMap: tokenMap };
    },

    /**
     * Masks an array of objects (e.g. a list of GlideRecord-sourced rows).
     * @param {Array} dataArray
     * @returns {Object} { maskedData: Array, tokenMap: Object }
     */
    maskArray: function(dataArray) {
        var allMasked = [];
        var allTokenMap = {};

        for (var i = 0; i < dataArray.length; i++) {
            var result = this.mask(dataArray[i]);
            allMasked.push(result.maskedData);
            for (var token in result.tokenMap) {
                if (result.tokenMap.hasOwnProperty(token)) {
                    allTokenMap[token] = result.tokenMap[token];
                }
            }
        }

        return { maskedData: allMasked, tokenMap: allTokenMap };
    },

    _isPIIField: function(fieldName) {
        var lower = fieldName.toLowerCase();
        for (var i = 0; i < this.PII_FIELDS.length; i++) {
            if (lower === this.PII_FIELDS[i]) {
                return true;
            }
        }
        return false;
    },

    type: 'SAGEBRUSHDataMasker'
};
