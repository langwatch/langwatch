import type { IncomingWebhookSendArguments } from "@slack/webhook";

/** One Slack incoming-webhook message billing posts. */
export type BillingSlackMessage = IncomingWebhookSendArguments;

/** Billing's Slack alerts, posted to the webhook URL each alert is configured with. */
export abstract class BillingSlackChannel {
  abstract send(input: { webhookUrl: string; message: BillingSlackMessage }): Promise<void>;
}
