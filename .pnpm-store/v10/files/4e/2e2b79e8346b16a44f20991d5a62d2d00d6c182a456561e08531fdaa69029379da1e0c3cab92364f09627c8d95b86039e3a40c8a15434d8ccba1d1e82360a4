import { APIResource } from "../../../core/resource.js";
import { APIPromise } from "../../../core/api-promise.js";
import { RequestOptions } from "../../../internal/request-options.js";
export declare class SpendLimit extends APIResource {
    /**
     * Get the organization's hard spend limit.
     *
     * @example
     * ```ts
     * const organizationSpendLimit =
     *   await client.admin.organization.spendLimit.retrieve();
     * ```
     */
    retrieve(options?: RequestOptions): APIPromise<OrganizationSpendLimit>;
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
    update(body: SpendLimitUpdateParams, options?: RequestOptions): APIPromise<OrganizationSpendLimit>;
    /**
     * Delete the organization's hard spend limit.
     *
     * @example
     * ```ts
     * const organizationSpendLimitDeleted =
     *   await client.admin.organization.spendLimit.delete();
     * ```
     */
    delete(options?: RequestOptions): APIPromise<OrganizationSpendLimitDeleted>;
}
/**
 * Represents a hard spend limit configured at the organization level.
 */
export interface OrganizationSpendLimit {
    /**
     * The currency for the threshold amount. Currently, only `USD` is supported.
     */
    currency: (string & {}) | 'USD';
    /**
     * The current enforcement state of the hard spend limit.
     */
    enforcement: OrganizationSpendLimit.Enforcement;
    /**
     * The time interval for evaluating spend against the threshold. Currently, only
     * `month` is supported.
     */
    interval: (string & {}) | 'month';
    /**
     * The object type, which is always `organization.spend_limit`.
     */
    object: 'organization.spend_limit';
    /**
     * The hard spend limit amount, in cents.
     */
    threshold_amount: number;
}
export declare namespace OrganizationSpendLimit {
    /**
     * The current enforcement state of the hard spend limit.
     */
    interface Enforcement {
        /**
         * Whether the hard spend limit is currently enforcing.
         */
        status: (string & {}) | 'inactive' | 'enforcing';
    }
}
/**
 * Confirmation payload returned after deleting an organization hard spend limit.
 */
export interface OrganizationSpendLimitDeleted {
    /**
     * Whether the hard spend limit was deleted.
     */
    deleted: boolean;
    /**
     * The object type, which is always `organization.spend_limit.deleted`.
     */
    object: 'organization.spend_limit.deleted';
}
export interface SpendLimitUpdateParams {
    /**
     * The currency for the threshold amount. Currently, only `USD` is supported.
     */
    currency: 'USD';
    /**
     * The time interval for evaluating spend against the threshold. Currently, only
     * `month` is supported.
     */
    interval: 'month';
    /**
     * The hard spend limit amount, in cents.
     */
    threshold_amount: number;
}
export declare namespace SpendLimit {
    export { type OrganizationSpendLimit as OrganizationSpendLimit, type OrganizationSpendLimitDeleted as OrganizationSpendLimitDeleted, type SpendLimitUpdateParams as SpendLimitUpdateParams, };
}
//# sourceMappingURL=spend-limit.d.ts.map