import type { HttpWebhookSender, SqsWebhookSender } from "./webhook-destination.channel.ts";

/** Every channel webhook holds, as the container hands them to the module class. */
export interface WebhookChannels {
  readonly http: HttpWebhookSender;
  readonly sqs: SqsWebhookSender;
}
