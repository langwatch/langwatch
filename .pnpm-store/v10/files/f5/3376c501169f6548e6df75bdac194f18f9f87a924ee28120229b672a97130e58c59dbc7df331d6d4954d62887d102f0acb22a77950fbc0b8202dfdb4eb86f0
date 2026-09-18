"use strict";
// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataRetention = void 0;
const resource_1 = require("../../../../core/resource.js");
const path_1 = require("../../../../internal/utils/path.js");
class DataRetention extends resource_1.APIResource {
    /**
     * Retrieves project data retention controls.
     *
     * @example
     * ```ts
     * const projectDataRetention =
     *   await client.admin.organization.projects.dataRetention.retrieve(
     *     'project_id',
     *   );
     * ```
     */
    retrieve(projectID, options) {
        return this._client.get((0, path_1.path) `/organization/projects/${projectID}/data_retention`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Updates project data retention controls.
     *
     * @example
     * ```ts
     * const projectDataRetention =
     *   await client.admin.organization.projects.dataRetention.update(
     *     'project_id',
     *     { retention_type: 'organization_default' },
     *   );
     * ```
     */
    update(projectID, body, options) {
        return this._client.post((0, path_1.path) `/organization/projects/${projectID}/data_retention`, {
            body,
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
exports.DataRetention = DataRetention;
//# sourceMappingURL=data-retention.js.map