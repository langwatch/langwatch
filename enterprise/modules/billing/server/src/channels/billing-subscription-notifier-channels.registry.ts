import { MemoryBillingSubscriptionNotifierChannel } from "./memory/memory.billing-subscription-notifier.channel.ts";

/**
 * Channels for BillingSubscriptionNotifier. Wiring through defineChannels()
 * later is a one-line swap.
 */
export const billingSubscriptionNotifierChannels = {
  memory: MemoryBillingSubscriptionNotifierChannel,
};
