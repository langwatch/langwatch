"use strict";
// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpendLimit = void 0;
const resource_1 = require("../../../core/resource.js");
class SpendLimit extends resource_1.APIResource {
    /**
     * Get the organization's hard spend limit.
     *
     * @example
     * ```ts
     * const organizationSpendLimit =
     *   await client.admin.organization.spendLimit.retrieve();
     * ```
     */
    retrieve(options) {
        return this._client.get('/organization/spend_limit', {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Create or replace the organization's hard spend limit.
     *
     * @example
     * ```ts
     * const organizationSpendLimit =
     *   await client.admin.organization.spendLimit.update({
     *     currency: 'USD',
     *     interval: 'month',
     *     threshold_amount: 1,
     *   });
     * ```
     */
    update(body, options) {
        return this._client.post('/organization/spend_limit', {
            body,
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Delete the organization's hard spend limit.
     *
     * @example
     * ```ts
     * const organizationSpendLimitDeleted =
     *   await client.admin.organization.spendLimit.delete();
     * ```
     */
    delete(options) {
        return this._client.delete('/organization/spend_limit', {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
exports.SpendLimit = SpendLimit;
//# sourceMappingURL=spend-limit.js.map