"use strict";
// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataRetention = void 0;
const resource_1 = require("../../../core/resource.js");
class DataRetention extends resource_1.APIResource {
    /**
     * Retrieves organization data retention controls.
     *
     * @example
     * ```ts
     * const organizationDataRetention =
     *   await client.admin.organization.dataRetention.retrieve();
     * ```
     */
    retrieve(options) {
        return this._client.get('/organization/data_retention', {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Updates organization data retention controls.
     *
     * @example
     * ```ts
     * const organizationDataRetention =
     *   await client.admin.organization.dataRetention.update({
     *     retention_type: 'zero_data_retention',
     *   });
     * ```
     */
    update(body, options) {
        return this._client.post('/organization/data_retention', {
            body,
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
exports.DataRetention = DataRetention;
//# sourceMappingURL=data-retention.js.map