import type { AutomationServerConfig } from "@langwatch/automation-contract";

import type { AutomationChannels } from "../automation.channels.ts";
import { SlackWebApiTransportChannel } from "../slack/slack.web-api-transport.channel.ts";
import { SlackWebhookClientChannel } from "../slack/slack.webhook-client.channel.ts";

/** Slack messages leave over its incoming webhooks and its Web API. */
export class HttpAutomationChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: AutomationServerConfig }): AutomationChannels {
    return {
      slackWebhookClient: SlackWebhookClientChannel.create({
        webhookBase: config.slackWebhookBase,
      }),
      slackApiTransport: SlackWebApiTransportChannel.create({ apiBase: config.slackApiBase }),
    };
  }
}
