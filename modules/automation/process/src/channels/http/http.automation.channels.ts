import type { AutomationChannels } from "../automation.channels.ts";
import { SlackWebApiTransportChannel } from "../slack/slack.web-api-transport.channel.ts";
import { SlackWebhookClientChannel } from "../slack/slack.webhook-client.channel.ts";

/** Slack messages leave over its incoming webhooks and its Web API. */
export class HttpAutomationChannels {
  static readonly requires = [] as const;

  static create(): AutomationChannels {
    return {
      slackWebhookClient: SlackWebhookClientChannel.create(),
      slackApiTransport: SlackWebApiTransportChannel.create(),
    };
  }
}
