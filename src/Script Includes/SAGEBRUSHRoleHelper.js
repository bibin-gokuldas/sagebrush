/**
 * @name SAGEBRUSHRoleHelper
 * @callable_from_other_scopes true
 * @access public
 * @scope x_snc_sagebrush
 */
var SAGEBRUSHRoleHelper = Class.create();
SAGEBRUSHRoleHelper.prototype = {

    DOMAIN_ROLES: {
        'itsm':        ['itil', 'x_snc_sagebrush.admin', 'x_snc_sagebrush.architect'],
        'itom':        ['discovery_admin', 'x_snc_sagebrush.architect'],
        'grc':         ['sn_grc.admin', 'x_snc_sagebrush.architect'],
        'bcm':         ['sn_bcm.admin', 'x_snc_sagebrush.architect'],
        'csm':         ['sn_customerservice.admin', 'x_snc_sagebrush.architect'],
        'hrsd':        ['sn_hr_core.admin', 'x_snc_sagebrush.architect'],
        'foundational':['admin', 'x_snc_sagebrush.architect']
    },

    initialize: function() {
        this.log = new GSLog('x_snc_sagebrush.role', 'SAGEBRUSHRoleHelper');
    },

    /**
     * Returns the highest SAGEBRUSH role for a user.
     * @param {string} userId - sys_user sys_id (defaults to current user)
     * @returns {string} architect | admin | viewer | none
     */
    getUserRole: function(userId) {
        var uid = userId || gs.getUserID();
        if (this._userHasRole(uid, 'x_snc_sagebrush.architect')) { return 'architect'; }
        if (this._userHasRole(uid, 'x_snc_sagebrush.admin'))     { return 'admin'; }
        if (this._userHasRole(uid, 'x_snc_sagebrush.viewer'))    { return 'viewer'; }
        return 'none';
    },

    /**
     * Checks if a user is entitled to access a specific domain.
     * @param {string} userId
     * @param {string} domain - itsm|itom|grc|bcm|csm|hrsd|foundational
     * @returns {Boolean}
     */
    canAccessDomain: function(userId, domain) {
        if (!domain) { return false; }
        var uid = userId || gs.getUserID();
        if (this._userHasRole(uid, 'x_snc_sagebrush.architect')) { return true; }

        var domainRoles = this.DOMAIN_ROLES[domain.toLowerCase()];
        if (!domainRoles) { return false; }

        for (var i = 0; i < domainRoles.length; i++) {
            if (this._userHasRole(uid, domainRoles[i])) { return true; }
        }
        return false;
    },

    /**
     * Private helper: check if a user has a specific role.
     * @private
     * @param {string} uid - sys_user sys_id
     * @param {string} roleName - Role name to check
     * @returns {Boolean}
     */
    _userHasRole: function(uid, roleName) {
        if (uid === gs.getUserID()) {
            return gs.hasRole(roleName);
        }
        // For other users, query sys_user_has_role
        var userRole = new GlideRecord('sys_user_has_role');
        userRole.addQuery('user', uid);
        userRole.addQuery('role.name', roleName);
        userRole.addQuery('state', 'active');
        userRole.setLimit(1);
        userRole.query();
        return userRole.next();
    },

    type: 'SAGEBRUSHRoleHelper'
};
