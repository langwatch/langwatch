import {
  IncomingWebhook,
  type IncomingWebhookSendArguments,
} from "@slack/webhook";
import type { TriggerNotifier } from "~/server/app-layer/triggers/trigger-template.service";
import { sendEmail } from "~/server/mailer/emailSender";

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
    // Defense-in-depth SSRF guard: even though the persisted webhook is
    // validated at save time, the test-fire path can supply an arbitrary URL,
    // so re-enforce the same Slack-host allow-list here before posting.
    if (!isSlackWebhookUrl(webhook)) {
      throw new Error(
        "Slack webhook must be a valid https://hooks.slack.com/ URL.",
      );
    }
    await new IncomingWebhook(webhook).send(
      payload as IncomingWebhookSendArguments,
    );
  },
};

function isSlackWebhookUrl(webhook: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(webhook);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    (parsed.host === "hooks.slack.com" || parsed.host === "hooks.slack.com:443")
  );
}
