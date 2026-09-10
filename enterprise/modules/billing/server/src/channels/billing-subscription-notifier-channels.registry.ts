import { MemoryBillingSubscriptionNotifierChannel } from "./memory/memory.billing-subscription-notifier.channel.ts";

/**
 * The tiers behind `BillingSubscriptionNotifier`.
 *
 * Plain object rather than `defineChannels({ live, memory })` from
 * `@langwatch/eventing`: that helper is still landing (ADR-144's channel
 * layer). This is the same shape `defineChannels` will take, so wiring it
 * through later is a one-line swap, not a redesign.
 *
 * There is no live tier in this package: delivery is the composing process's
 * own notification transport, so a process without one binds this twin and
 * drops the notice.
 */
export const billingSubscriptionNotifierChannels = {
  memory: MemoryBillingSubscriptionNotifierChannel,
};
