// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
import { APIResource } from "../../../core/resource.mjs";
export class SpendLimit extends APIResource {
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
//# sourceMappingURL=spend-limit.mjs.map