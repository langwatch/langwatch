import type { SubscriptionNotificationPayload } from "@langwatch/enterprise-billing-contract";

import { BillingSubscriptionNotifier } from "../billing-subscription-notifier.channel.ts";

/** Main's `notifications.sendSlackSubscriptionEvent`: a subscription change posted to Slack. */
export class SlackBillingSubscriptionNotifierChannel extends BillingSubscriptionNotifier {
  private constructor(
    private readonly notices: {
      sendSlackSubscriptionEvent(payload: SubscriptionNotificationPayload): Promise<void>;
    },
  ) {
    super();
  }

  static create(options: {
    notices: {
      sendSlackSubscriptionEvent(payload: SubscriptionNotificationPayload): Promise<void>;
    };
  }): SlackBillingSubscriptionNotifierChannel {
    return new SlackBillingSubscriptionNotifierChannel(options.notices);
  }

  send(payload: SubscriptionNotificationPayload): Promise<void> {
    return this.notices.sendSlackSubscriptionEvent(payload);
  }
}
