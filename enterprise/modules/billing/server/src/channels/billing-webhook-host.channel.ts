import type { RetentionCategory } from "@langwatch/data-retention-contract";
import type { SubscriptionNotificationPayload } from "@langwatch/enterprise-billing-contract";

/**
 * The two things a Stripe webhook reaches OUTSIDE billing: the operators'
 * Slack channel, and the data-retention rules a new paid subscription resets.
 *
 * Both were read off a process-wide service locator. They arrive as a channel so
 * a deployment that composes neither still processes the webhook — the money
 * side of the event is what must land, and an unsent Slack line or an
 * unwritten retention default is not a reason to make Stripe retry a payment
 * it already took.
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
