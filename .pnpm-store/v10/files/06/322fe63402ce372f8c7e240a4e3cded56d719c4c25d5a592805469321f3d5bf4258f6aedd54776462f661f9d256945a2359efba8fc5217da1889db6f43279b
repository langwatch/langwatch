"use strict";
// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelPermissions = void 0;
const resource_1 = require("../../../../core/resource.js");
const path_1 = require("../../../../internal/utils/path.js");
class ModelPermissions extends resource_1.APIResource {
    /**
     * Returns model permissions for a project.
     *
     * @example
     * ```ts
     * const projectModelPermissions =
     *   await client.admin.organization.projects.modelPermissions.retrieve(
     *     'project_id',
     *   );
     * ```
     */
    retrieve(projectID, options) {
        return this._client.get((0, path_1.path) `/organization/projects/${projectID}/model_permissions`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Updates model permissions for a project.
     *
     * @example
     * ```ts
     * const projectModelPermissions =
     *   await client.admin.organization.projects.modelPermissions.update(
     *     'project_id',
     *     { mode: 'allow_list', model_ids: ['string'] },
     *   );
     * ```
     */
    update(projectID, body, options) {
        return this._client.post((0, path_1.path) `/organization/projects/${projectID}/model_permissions`, {
            body,
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Deletes model permissions for a project.
     *
     * @example
     * ```ts
     * const projectModelPermissionsDeleted =
     *   await client.admin.organization.projects.modelPermissions.delete(
     *     'project_id',
     *   );
     * ```
     */
    delete(projectID, options) {
        return this._client.delete((0, path_1.path) `/organization/projects/${projectID}/model_permissions`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
exports.ModelPermissions = ModelPermissions;
//# sourceMappingURL=model-permissions.js.map