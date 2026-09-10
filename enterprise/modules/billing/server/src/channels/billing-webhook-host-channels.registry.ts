import { MemoryBillingWebhookHostChannel } from "./memory/memory.billing-webhook-host.channel.ts";

/**
 * The tiers behind `BillingWebhookHost`.
 *
 * Plain object rather than `defineChannels({ live, memory })` from
 * `@langwatch/eventing`: that helper is still landing (ADR-144's channel
 * layer). This is the same shape `defineChannels` will take, so wiring it
 * through later is a one-line swap, not a redesign.
 *
 * There is no live tier in this package: the Slack line and the retention
 * default are both peers the composing process reaches, so a process that has
 * them binds its own implementation and one that has not binds this twin.
 */
export const billingWebhookHostChannels = {
  memory: MemoryBillingWebhookHostChannel,
};
