import { MemoryBillingSubscriptionNotifierChannel } from "./memory/memory.billing-subscription-notifier.channel.ts";
import { SlackBillingSubscriptionNotifierChannel } from "./slack/slack.billing-subscription-notifier.channel.ts";

export const billingSubscriptionNotifierChannels = {
  slack: SlackBillingSubscriptionNotifierChannel,
  memory: MemoryBillingSubscriptionNotifierChannel,
};
