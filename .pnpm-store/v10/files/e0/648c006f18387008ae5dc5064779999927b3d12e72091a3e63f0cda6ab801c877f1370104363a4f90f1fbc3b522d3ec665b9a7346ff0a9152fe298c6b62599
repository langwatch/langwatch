"use strict";
// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostedToolPermissions = void 0;
const resource_1 = require("../../../../core/resource.js");
const path_1 = require("../../../../internal/utils/path.js");
class HostedToolPermissions extends resource_1.APIResource {
    /**
     * Returns hosted tool permissions for a project.
     *
     * @example
     * ```ts
     * const projectHostedToolPermissions =
     *   await client.admin.organization.projects.hostedToolPermissions.retrieve(
     *     'project_id',
     *   );
     * ```
     */
    retrieve(projectID, options) {
        return this._client.get((0, path_1.path) `/organization/projects/${projectID}/hosted_tool_permissions`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Updates hosted tool permissions for a project.
     *
     * @example
     * ```ts
     * const projectHostedToolPermissions =
     *   await client.admin.organization.projects.hostedToolPermissions.update(
     *     'project_id',
     *   );
     * ```
     */
    update(projectID, body, options) {
        return this._client.post((0, path_1.path) `/organization/projects/${projectID}/hosted_tool_permissions`, {
            body,
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
exports.HostedToolPermissions = HostedToolPermissions;
//# sourceMappingURL=hosted-tool-permissions.js.map