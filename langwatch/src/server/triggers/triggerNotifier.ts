import {
  IncomingWebhook,
  type IncomingWebhookSendArguments,
} from "@slack/webhook";
import { sendEmail } from "~/server/mailer/emailSender";
import type { TriggerNotifier } from "~/server/app-layer/triggers/trigger-template.service";

/**
 * Production delivery for trigger test fires: the email path reuses the shared
 * SES/SendGrid sender, the Slack path posts the already-rendered payload (plain
 * `text` or allow-listed `blocks`) straight to the incoming webhook.
 */
export const liveTriggerNotifier: TriggerNotifier = {
  async sendEmail({ to, bcc, subject, html }) {
    await sendEmail({ to, bcc, subject, html });
  },
  async sendSlack({ webhook, payload }) {
    await new IncomingWebhook(webhook).send(
      payload as IncomingWebhookSendArguments,
    );
  },
};
