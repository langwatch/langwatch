"use strict";
// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpendAlerts = void 0;
const resource_1 = require("../../../../core/resource.js");
const pagination_1 = require("../../../../core/pagination.js");
const path_1 = require("../../../../internal/utils/path.js");
class SpendAlerts extends resource_1.APIResource {
    /**
     * Creates a project spend alert.
     *
     * @example
     * ```ts
     * const projectSpendAlert =
     *   await client.admin.organization.projects.spendAlerts.create(
     *     'project_id',
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
    create(projectID, body, options) {
        return this._client.post((0, path_1.path) `/organization/projects/${projectID}/spend_alerts`, {
            body,
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Retrieves a project spend alert.
     *
     * @example
     * ```ts
     * const projectSpendAlert =
     *   await client.admin.organization.projects.spendAlerts.retrieve(
     *     'alert_id',
     *     { project_id: 'project_id' },
     *   );
     * ```
     */
    retrieve(alertID, params, options) {
        const { project_id } = params;
        return this._client.get((0, path_1.path) `/organization/projects/${project_id}/spend_alerts/${alertID}`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Updates a project spend alert.
     *
     * @example
     * ```ts
     * const projectSpendAlert =
     *   await client.admin.organization.projects.spendAlerts.update(
     *     'alert_id',
     *     {
     *       project_id: 'project_id',
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
    update(alertID, params, options) {
        const { project_id, ...body } = params;
        return this._client.post((0, path_1.path) `/organization/projects/${project_id}/spend_alerts/${alertID}`, {
            body,
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
    /**
     * Lists project spend alerts.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const projectSpendAlert of client.admin.organization.projects.spendAlerts.list(
     *   'project_id',
     * )) {
     *   // ...
     * }
     * ```
     */
    list(projectID, query = {}, options) {
        return this._client.getAPIList((0, path_1.path) `/organization/projects/${projectID}/spend_alerts`, (pagination_1.ConversationCursorPage), { query, ...options, __security: { adminAPIKeyAuth: true } });
    }
    /**
     * Deletes a project spend alert.
     *
     * @example
     * ```ts
     * const projectSpendAlertDeleted =
     *   await client.admin.organization.projects.spendAlerts.delete(
     *     'alert_id',
     *     { project_id: 'project_id' },
     *   );
     * ```
     */
    delete(alertID, params, options) {
        const { project_id } = params;
        return this._client.delete((0, path_1.path) `/organization/projects/${project_id}/spend_alerts/${alertID}`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
exports.SpendAlerts = SpendAlerts;
//# sourceMappingURL=spend-alerts.js.map