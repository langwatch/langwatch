// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
import { APIResource } from "../../../../core/resource.mjs";
import { path } from "../../../../internal/utils/path.mjs";
export class SpendLimit extends APIResource {
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
    retrieve(projectID, options) {
        return this._client.get(path `/organization/projects/${projectID}/spend_limit`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
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
    update(projectID, body, options) {
        return this._client.post(path `/organization/projects/${projectID}/spend_limit`, {
            body,
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
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
    delete(projectID, options) {
        return this._client.delete(path `/organization/projects/${projectID}/spend_limit`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
//# sourceMappingURL=spend-limit.mjs.map