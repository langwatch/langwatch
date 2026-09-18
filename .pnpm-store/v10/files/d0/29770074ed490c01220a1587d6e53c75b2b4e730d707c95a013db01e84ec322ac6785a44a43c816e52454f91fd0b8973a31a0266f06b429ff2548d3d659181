// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
import { APIResource } from "../../../../core/resource.mjs";
import { path } from "../../../../internal/utils/path.mjs";
export class DataRetention extends APIResource {
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
        return this._client.get(path `/organization/projects/${projectID}/data_retention`, {
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
        return this._client.post(path `/organization/projects/${projectID}/data_retention`, {
            body,
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
//# sourceMappingURL=data-retention.mjs.map