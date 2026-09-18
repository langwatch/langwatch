// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
import { APIResource } from "../../../../../core/resource.mjs";
import { path } from "../../../../../internal/utils/path.mjs";
export class APIKeys extends APIResource {
    /**
     * Creates an API key for a service account in the project.
     *
     * @example
     * ```ts
     * const apiKey =
     *   await client.admin.organization.projects.serviceAccounts.apiKeys.create(
     *     'service_account_id',
     *     { project_id: 'project_id' },
     *   );
     * ```
     */
    create(serviceAccountID, params, options) {
        const { project_id, ...body } = params;
        return this._client.post(path `/organization/projects/${project_id}/service_accounts/${serviceAccountID}/api_keys`, { body, ...options, __security: { adminAPIKeyAuth: true } });
    }
}
//# sourceMappingURL=api-keys.mjs.map