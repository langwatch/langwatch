import { MemoryBillingAlertChannel } from "./memory/memory.billing-alert.channel.ts";
import { SlackBillingAlertChannel } from "./slack/slack.billing-alert.channel.ts";

export const billingAlertChannels = {
  live: SlackBillingAlertChannel,
  memory: MemoryBillingAlertChannel,
};
