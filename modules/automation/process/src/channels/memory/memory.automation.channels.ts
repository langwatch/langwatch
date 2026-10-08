import type { AutomationChannels } from "../automation.channels.ts";
import { MemorySlackApiTransportChannel } from "./memory.slack-api-transport.channel.ts";
import { MemorySlackWebhookClientChannel } from "./memory.slack-webhook-client.channel.ts";

/** Slack sends are recorded in-process and always accepted. */
export class MemoryAutomationChannels {
  static readonly requires = [] as const;

  static create(): AutomationChannels {
    return {
      slackWebhookClient: MemorySlackWebhookClientChannel.create(),
      slackApiTransport: MemorySlackApiTransportChannel.create(),
    };
  }
}
