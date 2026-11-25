import type { SlackApiTransport } from "./slack/slack.web-api-delivery.channel.ts";
import type { SlackWebhookClientChannel } from "./slack/slack.webhook-client.channel.ts";

/** Every channel automation holds, as the container hands them to the module class. */
export interface AutomationChannels {
  readonly slackWebhookClient: Pick<SlackWebhookClientChannel, "send">;
  readonly slackApiTransport: SlackApiTransport;
}
