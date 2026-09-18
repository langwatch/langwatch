import { APIResource } from "../../../core/resource.mjs";
import { APIPromise } from "../../../core/api-promise.mjs";
import { ConversationCursorPage, type ConversationCursorPageParams, PagePromise } from "../../../core/pagination.mjs";
import { RequestOptions } from "../../../internal/request-options.mjs";
export declare class SpendAlerts extends APIResource {
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
    create(body: SpendAlertCreateParams, options?: RequestOptions): APIPromise<OrganizationSpendAlert>;
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
    retrieve(alertID: string, options?: RequestOptions): APIPromise<OrganizationSpendAlert>;
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
    update(alertID: string, body: SpendAlertUpdateParams, options?: RequestOptions): APIPromise<OrganizationSpendAlert>;
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
    list(query?: SpendAlertListParams | null | undefined, options?: RequestOptions): PagePromise<OrganizationSpendAlertsPage, OrganizationSpendAlert>;
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
    delete(alertID: string, options?: RequestOptions): APIPromise<OrganizationSpendAlertDeleted>;
}
export type OrganizationSpendAlertsPage = ConversationCursorPage<OrganizationSpendAlert>;
/**
 * Represents a spend alert configured at the organization level.
 */
export interface OrganizationSpendAlert {
    /**
     * The identifier, which can be referenced in API endpoints.
     */
    id: string;
    /**
     * The currency for the threshold amount.
     */
    currency: 'USD';
    /**
     * The time interval for evaluating spend against the threshold.
     */
    interval: 'month';
    /**
     * Email notification settings for a spend alert.
     */
    notification_channel: OrganizationSpendAlert.NotificationChannel;
    /**
     * The object type, which is always `organization.spend_alert`.
     */
    object: 'organization.spend_alert';
    /**
     * The alert threshold amount, in cents.
     */
    threshold_amount: number;
}
export declare namespace OrganizationSpendAlert {
    /**
     * Email notification settings for a spend alert.
     */
    interface NotificationChannel {
        /**
         * Email addresses that receive the spend alert notification.
         */
        recipients: Array<string>;
        /**
         * The notification channel type. Currently only `email` is supported.
         */
        type: 'email';
        /**
         * Optional subject prefix for alert emails.
         */
        subject_prefix?: string | null;
    }
}
/**
 * Confirmation payload returned after deleting an organization spend alert.
 */
export interface OrganizationSpendAlertDeleted {
    /**
     * The deleted spend alert ID.
     */
    id: string;
    /**
     * Whether the spend alert was deleted.
     */
    deleted: boolean;
    /**
     * Always `organization.spend_alert.deleted`.
     */
    object: 'organization.spend_alert.deleted';
}
export interface SpendAlertCreateParams {
    /**
     * The currency for the threshold amount.
     */
    currency: 'USD';
    /**
     * The time interval for evaluating spend against the threshold.
     */
    interval: 'month';
    /**
     * Email notification settings for a spend alert.
     */
    notification_channel: SpendAlertCreateParams.NotificationChannel;
    /**
     * The alert threshold amount, in cents.
     */
    threshold_amount: number;
}
export declare namespace SpendAlertCreateParams {
    /**
     * Email notification settings for a spend alert.
     */
    interface NotificationChannel {
        /**
         * Email addresses that receive the spend alert notification.
         */
        recipients: Array<string>;
        /**
         * The notification channel type. Currently only `email` is supported.
         */
        type: 'email';
        /**
         * Optional subject prefix for alert emails.
         */
        subject_prefix?: string | null;
    }
}
export interface SpendAlertUpdateParams {
    /**
     * The currency for the threshold amount.
     */
    currency: 'USD';
    /**
     * The time interval for evaluating spend against the threshold.
     */
    interval: 'month';
    /**
     * Email notification settings for a spend alert.
     */
    notification_channel: SpendAlertUpdateParams.NotificationChannel;
    /**
     * The alert threshold amount, in cents.
     */
    threshold_amount: number;
}
export declare namespace SpendAlertUpdateParams {
    /**
     * Email notification settings for a spend alert.
     */
    interface NotificationChannel {
        /**
         * Email addresses that receive the spend alert notification.
         */
        recipients: Array<string>;
        /**
         * The notification channel type. Currently only `email` is supported.
         */
        type: 'email';
        /**
         * Optional subject prefix for alert emails.
         */
        subject_prefix?: string | null;
    }
}
export interface SpendAlertListParams extends ConversationCursorPageParams {
    /**
     * Cursor for pagination. Provide the ID of the first spend alert from the previous
     * response to fetch the previous page.
     */
    before?: string;
    /**
     * Sort order for the returned spend alerts.
     */
    order?: 'asc' | 'desc';
}
export declare namespace SpendAlerts {
    export { type OrganizationSpendAlert as OrganizationSpendAlert, type OrganizationSpendAlertDeleted as OrganizationSpendAlertDeleted, type OrganizationSpendAlertsPage as OrganizationSpendAlertsPage, type SpendAlertCreateParams as SpendAlertCreateParams, type SpendAlertUpdateParams as SpendAlertUpdateParams, type SpendAlertListParams as SpendAlertListParams, };
}
//# sourceMappingURL=spend-alerts.d.mts.map