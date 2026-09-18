"use strict";
// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", { value: true });
exports.APIKeys = void 0;
const resource_1 = require("../../../../../core/resource.js");
const path_1 = require("../../../../../internal/utils/path.js");
class APIKeys extends resource_1.APIResource {
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
        return this._client.post((0, path_1.path) `/organization/projects/${project_id}/service_accounts/${serviceAccountID}/api_keys`, { body, ...options, __security: { adminAPIKeyAuth: true } });
    }
}
exports.APIKeys = APIKeys;
//# sourceMappingURL=api-keys.js.map