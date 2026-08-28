import type { SubscriptionNotificationPayload } from "@langwatch/enterprise-billing-contract";

/** Runtime delivery seam for internal subscription notifications. */
export abstract class BillingSubscriptionNotifierPort {
  abstract send(payload: SubscriptionNotificationPayload): Promise<void>;
}
