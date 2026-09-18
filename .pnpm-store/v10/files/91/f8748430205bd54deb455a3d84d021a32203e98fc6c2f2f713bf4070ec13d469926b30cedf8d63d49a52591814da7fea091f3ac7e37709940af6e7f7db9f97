// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
import { APIResource } from "../../../../core/resource.mjs";
import { ConversationCursorPage, } from "../../../../core/pagination.mjs";
import { path } from "../../../../internal/utils/path.mjs";
export class SpendAlerts extends APIResource {
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
        return this._client.post(path `/organization/projects/${projectID}/spend_alerts`, {
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
        return this._client.get(path `/organization/projects/${project_id}/spend_alerts/${alertID}`, {
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
        return this._client.post(path `/organization/projects/${project_id}/spend_alerts/${alertID}`, {
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
        return this._client.getAPIList(path `/organization/projects/${projectID}/spend_alerts`, (ConversationCursorPage), { query, ...options, __security: { adminAPIKeyAuth: true } });
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
        return this._client.delete(path `/organization/projects/${project_id}/spend_alerts/${alertID}`, {
            ...options,
            __security: { adminAPIKeyAuth: true },
        });
    }
}
//# sourceMappingURL=spend-alerts.mjs.map