import type { SubscriptionNotificationPayload } from "@langwatch/enterprise-billing-contract";

import { BillingWebhookHost } from "../billing-webhook-host.channel.ts";

/** The Slack alerts a subscription change posts, as the notice service sends them. */
type BillingWebhookSlackNotices = {
  sendSlackSubscriptionEvent(payload: SubscriptionNotificationPayload): Promise<void>;
  sendSlackBillingThresholdFailureAlert(input: {
    stripeSubscriptionId: string;
    reason: string;
  }): Promise<void>;
};

/** What a Stripe delivery posts to Slack, through the configured notice channels. */
export class SlackBillingWebhookHostChannel extends BillingWebhookHost {
  private constructor(private readonly notices: BillingWebhookSlackNotices) {
    super();
  }

  static create(options: { notices: BillingWebhookSlackNotices }): SlackBillingWebhookHostChannel {
    return new SlackBillingWebhookHostChannel(options.notices);
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
}
