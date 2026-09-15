import { MemoryBillingWebhookHostChannel } from "./memory/memory.billing-webhook-host.channel.ts";

/**
 * Channels for BillingWebhookHost. Wiring through defineChannels()
 * later is a one-line swap.
 */
export const billingWebhookHostChannels = {
  memory: MemoryBillingWebhookHostChannel,
};
