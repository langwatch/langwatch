import type { SubscriptionNotificationPayload } from "@langwatch/enterprise-billing-contract";

/** An Enterprise organization's failed charge, as the account team is told of it. */
export type AccountPaymentFailedAlert = Readonly<{
  organizationId: string;
  organizationName: string;
  stripeInvoiceId: string;
  amount: string;
}>;

/** The Slack alerts a Stripe delivery posts; retention goes to data-retention's own Api. */
export abstract class BillingWebhookHost {
  abstract sendSlackSubscriptionEvent(payload: SubscriptionNotificationPayload): Promise<void>;

  abstract sendSlackBillingThresholdFailureAlert(input: {
    stripeSubscriptionId: string;
    reason: string;
  }): Promise<void>;

  abstract sendSlackAccountPaymentFailed(input: AccountPaymentFailedAlert): Promise<void>;
}
