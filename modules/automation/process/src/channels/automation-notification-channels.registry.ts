import { HttpWebhookDeliveryChannel } from "./http/http.webhook-delivery.channel.ts";
import { SlackWebApiTransportChannel } from "./slack/slack-web-api-transport.channel.ts";
import { SlackWebApiDeliveryChannel } from "./slack/slack.web-api-delivery.channel.ts";
import { SlackWebhookClientChannel } from "./slack/slack.webhook-client.channel.ts";
import { SlackWebhookDeliveryChannel } from "./slack/slack.webhook-delivery.channel.ts";

export type {
  WebhookDeliveryRequest,
  WebhookDeliveryTransport,
  WebhookSendResult,
} from "./http/http.webhook-delivery.channel.ts";
export type { SlackApiTransport } from "./slack/slack.web-api-delivery.channel.ts";
export type {
  HttpWebhookDeliveryChannel,
  SlackWebApiDeliveryChannel,
  SlackWebhookClientChannel,
  SlackWebhookDeliveryChannel,
};

export const automationNotificationChannels = {
  webhook: HttpWebhookDeliveryChannel,
  slackWebhook: SlackWebhookDeliveryChannel,
  slackWebhookClient: SlackWebhookClientChannel,
  slackApi: SlackWebApiDeliveryChannel,
  slackApiTransport: SlackWebApiTransportChannel,
};
