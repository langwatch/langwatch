import { MemoryBillingWebhookHostChannel } from "./memory/memory.billing-webhook-host.channel.ts";
import { SlackBillingWebhookHostChannel } from "./slack/slack.billing-webhook-host.channel.ts";

export const billingWebhookHostChannels = {
  slack: SlackBillingWebhookHostChannel,
  memory: MemoryBillingWebhookHostChannel,
};
