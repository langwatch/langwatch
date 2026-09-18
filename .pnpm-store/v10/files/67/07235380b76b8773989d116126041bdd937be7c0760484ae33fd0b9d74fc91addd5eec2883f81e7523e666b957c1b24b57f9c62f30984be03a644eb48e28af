"use strict";
// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpendLimit = void 0;
const resource_1 = require("../../../../core/resource.js");
const path_1 = require("../../../../internal/utils/path.js");
class SpendLimit extends resource_1.APIResource {
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
        return this._client.get((0, path_1.path) `/organization/projects/${projectID}/spend_limit`, {
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
        return this._client.post((0, path_1.path) `/organization/projects/${projectID}/spend_limit`, {
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
        return this._client.delete((0, path_1.path) `/organization/projects/${projectID}/spend_limit`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
exports.SpendLimit = SpendLimit;
//# sourceMappingURL=spend-limit.js.map