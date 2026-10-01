import type { SubscriptionNotificationPayload } from "@langwatch/enterprise-billing-contract";

/** The Slack alerts a Stripe delivery posts; retention goes to data-retention's own Api. */
export abstract class BillingWebhookHost {
  abstract sendSlackSubscriptionEvent(payload: SubscriptionNotificationPayload): Promise<void>;

  abstract sendSlackBillingThresholdFailureAlert(input: {
    stripeSubscriptionId: string;
    reason: string;
  }): Promise<void>;
}
