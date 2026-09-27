import type { DataRetentionApi, RetentionCategory } from "@langwatch/data-retention-contract";
import type { SubscriptionNotificationPayload } from "@langwatch/enterprise-billing-contract";

import { BillingWebhookHost } from "../billing-webhook-host.channel.ts";

/** The Slack alerts a subscription change posts, as the notice service sends them. */
export type BillingWebhookSlackNotices = {
  sendSlackSubscriptionEvent(payload: SubscriptionNotificationPayload): Promise<void>;
  sendSlackBillingThresholdFailureAlert(input: {
    stripeSubscriptionId: string;
    reason: string;
  }): Promise<void>;
};

/** What a Stripe delivery reaches outside billing: Slack, and data-retention's rules. */
export class SlackBillingWebhookHostChannel extends BillingWebhookHost {
  private constructor(
    private readonly notices: BillingWebhookSlackNotices,
    private readonly retention: Pick<DataRetentionApi, "listOrganizationRules" | "setForScope">,
  ) {
    super();
  }

  static create(options: {
    notices: BillingWebhookSlackNotices;
    retention: Pick<DataRetentionApi, "listOrganizationRules" | "setForScope">;
  }): SlackBillingWebhookHostChannel {
    return new SlackBillingWebhookHostChannel(options.notices, options.retention);
  }

  sendSlackSubscriptionEvent(payload: SubscriptionNotificationPayload): Promise<void> {
    return this.notices.sendSlackSubscriptionEvent(payload);
  }

  sendSlackBillingThresholdFailureAlert(input: {
    stripeSubscriptionId: string;
    reason: string;
  }): Promise<void> {
    return this.notices.sendSlackBillingThresholdFailureAlert(input);
  }

  listOrganizationRetentionRules(input: {
    organizationId: string;
  }): Promise<{ scopeType: string; scopeId: string; category: string }[]> {
    return this.retention.listOrganizationRules(input);
  }

  async setOrganizationRetention(input: {
    scope: { scopeType: "ORGANIZATION"; scopeId: string };
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<void> {
    await this.retention.setForScope(input);
  }
}
