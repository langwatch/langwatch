"use strict";
// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpendAlerts = void 0;
const resource_1 = require("../../../core/resource.js");
const pagination_1 = require("../../../core/pagination.js");
const path_1 = require("../../../internal/utils/path.js");
class SpendAlerts extends resource_1.APIResource {
    /**
     * Creates an organization spend alert.
     *
     * @example
     * ```ts
     * const organizationSpendAlert =
     *   await client.admin.organization.spendAlerts.create({
     *     currency: 'USD',
     *     interval: 'month',
     *     notification_channel: {
     *       recipients: ['string'],
     *       type: 'email',
     *     },
     *     threshold_amount: 0,
     *   });
     * ```
     */
    create(body, options) {
        return this._client.post('/organization/spend_alerts', {
            body,
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Retrieves an organization spend alert.
     *
     * @example
     * ```ts
     * const organizationSpendAlert =
     *   await client.admin.organization.spendAlerts.retrieve(
     *     'alert_id',
     *   );
     * ```
     */
    retrieve(alertID, options) {
        return this._client.get((0, path_1.path) `/organization/spend_alerts/${alertID}`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Updates an organization spend alert.
     *
     * @example
     * ```ts
     * const organizationSpendAlert =
     *   await client.admin.organization.spendAlerts.update(
     *     'alert_id',
     *     {
     *       currency: 'USD',
     *       interval: 'month',
     *       notification_channel: {
     *         recipients: ['string'],
     *         type: 'email',
     *       },
     *       threshold_amount: 0,
     *     },
     *   );
     * ```
     */
    update(alertID, body, options) {
        return this._client.post((0, path_1.path) `/organization/spend_alerts/${alertID}`, {
            body,
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Lists organization spend alerts.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const organizationSpendAlert of client.admin.organization.spendAlerts.list()) {
     *   // ...
     * }
     * ```
     */
    list(query = {}, options) {
        return this._client.getAPIList('/organization/spend_alerts', (pagination_1.ConversationCursorPage), { query, ...options, __security: { adminAPIKeyAuth: true } });
    }
    /**
     * Deletes an organization spend alert.
     *
     * @example
     * ```ts
     * const organizationSpendAlertDeleted =
     *   await client.admin.organization.spendAlerts.delete(
     *     'alert_id',
     *   );
     * ```
     */
    delete(alertID, options) {
        return this._client.delete((0, path_1.path) `/organization/spend_alerts/${alertID}`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
exports.SpendAlerts = SpendAlerts;
//# sourceMappingURL=spend-alerts.js.map