import type { RetentionCategory } from "@langwatch/data-retention-contract";
import type { SubscriptionNotificationPayload } from "@langwatch/enterprise-billing-contract";

/**
 * Stripe webhook reaches Slack and data-retention rules outside billing.
 * Optional channels so money side lands even if they're absent.
 */
export abstract class BillingWebhookHost {
  abstract sendSlackSubscriptionEvent(payload: SubscriptionNotificationPayload): Promise<void>;

  abstract sendSlackBillingThresholdFailureAlert(input: {
    stripeSubscriptionId: string;
    reason: string;
  }): Promise<void>;

  abstract listOrganizationRetentionRules(input: {
    organizationId: string;
  }): Promise<Array<{ scopeType: string; scopeId: string; category: string }>>;

  abstract setOrganizationRetention(input: {
    scope: { scopeType: "ORGANIZATION"; scopeId: string };
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<void>;
}
