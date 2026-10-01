import { MemoryBillingSlackChannel } from "./memory/memory.billing-slack.channel.ts";
import { SlackBillingSlackChannel } from "./slack/slack.billing-slack.channel.ts";

export const billingSlackChannels = {
  live: SlackBillingSlackChannel,
  memory: MemoryBillingSlackChannel,
};
