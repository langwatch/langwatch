import { APIResource } from "../../../../core/resource.mjs";
import { APIPromise } from "../../../../core/api-promise.mjs";
import { RequestOptions } from "../../../../internal/request-options.mjs";
export declare class SpendLimit extends APIResource {
    /**
     * Get a project's hard spend limit.
     *
     * @example
     * ```ts
     * const projectSpendLimit =
     *   await client.admin.organization.projects.spendLimit.retrieve(
     *     'proj_123',
     *   );
     * ```
     */
    retrieve(projectID: string, options?: RequestOptions): APIPromise<ProjectSpendLimit>;
    /**
     * Create or replace a project's hard spend limit.
     *
     * @example
     * ```ts
     * const projectSpendLimit =
     *   await client.admin.organization.projects.spendLimit.update(
     *     'proj_123',
     *     {
     *       currency: 'USD',
     *       interval: 'month',
     *       threshold_amount: 1,
     *     },
     *   );
     * ```
     */
    update(projectID: string, body: SpendLimitUpdateParams, options?: RequestOptions): APIPromise<ProjectSpendLimit>;
    /**
     * Delete a project's hard spend limit.
     *
     * @example
     * ```ts
     * const projectSpendLimitDeleted =
     *   await client.admin.organization.projects.spendLimit.delete(
     *     'proj_123',
     *   );
     * ```
     */
    delete(projectID: string, options?: RequestOptions): APIPromise<ProjectSpendLimitDeleted>;
}
/**
 * Represents a hard spend limit configured at the project level.
 */
export interface ProjectSpendLimit {
    /**
     * The currency for the threshold amount. Currently, only `USD` is supported.
     */
    currency: (string & {}) | 'USD';
    /**
     * The current enforcement state of the hard spend limit.
     */
    enforcement: ProjectSpendLimit.Enforcement;
    /**
     * The time interval for evaluating spend against the threshold. Currently, only
     * `month` is supported.
     */
    interval: (string & {}) | 'month';
    /**
     * The object type, which is always `project.spend_limit`.
     */
    object: 'project.spend_limit';
    /**
     * The hard spend limit amount, in cents.
     */
    threshold_amount: number;
}
export declare namespace ProjectSpendLimit {
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
 * Confirmation payload returned after deleting a project hard spend limit.
 */
export interface ProjectSpendLimitDeleted {
    /**
     * Whether the hard spend limit was deleted.
     */
    deleted: boolean;
    /**
     * The object type, which is always `project.spend_limit.deleted`.
     */
    object: 'project.spend_limit.deleted';
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
    export { type ProjectSpendLimit as ProjectSpendLimit, type ProjectSpendLimitDeleted as ProjectSpendLimitDeleted, type SpendLimitUpdateParams as SpendLimitUpdateParams, };
}
//# sourceMappingURL=spend-limit.d.mts.map