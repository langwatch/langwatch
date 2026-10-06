import type { IncomingWebhookSendArguments } from "@slack/webhook";

/** One Slack incoming-webhook message billing posts. */
export type BillingAlertMessage = IncomingWebhookSendArguments;

/** Billing's Slack alerts, posted to the webhook URL each alert is configured with. */
export abstract class BillingAlertChannel {
  abstract send(input: { webhookUrl: string; message: BillingAlertMessage }): Promise<void>;
}
