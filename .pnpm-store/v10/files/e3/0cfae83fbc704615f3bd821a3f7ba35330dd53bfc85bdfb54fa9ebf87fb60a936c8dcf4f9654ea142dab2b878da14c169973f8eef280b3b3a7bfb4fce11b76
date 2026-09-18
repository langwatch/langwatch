// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
import { APIResource } from "../../../../core/resource.mjs";
import { path } from "../../../../internal/utils/path.mjs";
export class HostedToolPermissions extends APIResource {
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
        return this._client.get(path `/organization/projects/${projectID}/hosted_tool_permissions`, {
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
        return this._client.post(path `/organization/projects/${projectID}/hosted_tool_permissions`, {
            body,
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
//# sourceMappingURL=hosted-tool-permissions.mjs.map