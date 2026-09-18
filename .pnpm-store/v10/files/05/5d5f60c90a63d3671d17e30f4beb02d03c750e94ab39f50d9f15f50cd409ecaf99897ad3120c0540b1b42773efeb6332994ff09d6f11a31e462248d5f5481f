// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
import { APIResource } from "../../../core/resource.mjs";
import { ConversationCursorPage, } from "../../../core/pagination.mjs";
import { path } from "../../../internal/utils/path.mjs";
export class SpendAlerts extends APIResource {
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
        return this._client.get(path `/organization/spend_alerts/${alertID}`, {
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
        return this._client.post(path `/organization/spend_alerts/${alertID}`, {
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
        return this._client.getAPIList('/organization/spend_alerts', (ConversationCursorPage), { query, ...options, __security: { adminAPIKeyAuth: true } });
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
        return this._client.delete(path `/organization/spend_alerts/${alertID}`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
//# sourceMappingURL=spend-alerts.mjs.map