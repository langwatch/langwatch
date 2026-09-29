import type { TriggerNotifier } from "~/server/app-layer/automations/trigger-template.service";
import { sendEmail } from "~/server/mailer/emailSender";
import {
  assertWebhookDelivered,
  sendWebhook,
} from "~/server/webhooks/sendWebhook";
import { sendRenderedSlackMessage } from "./sendSlackWebhook";
import { postSlackChatMessage } from "./slackWebApi";

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
    // The same host guard and refusal classification a real fire takes: the
    // test-fire URL is author-supplied, and a refusal must reach them as prose.
    await sendRenderedSlackMessage({
      triggerWebhook: webhook,
      triggerName: "test fire",
      payload,
    });
  },
  async sendWebhook({
    url,
    method,
    headers,
    signingSecrets,
    body,
    contentType,
    triggerName,
  }) {
    // The full SSRF-fenced sender — same path a real fire takes — with the
    // non-suppressible test-fire marker header (ADR-040 §1). Non-2xx throws
    // the classified DispatchError so the author sees what the endpoint said.
    // `contentType` travels with the body: a test fire that announced JSON for
    // a plain-text automation would answer a question the author did not ask.
    const result = await sendWebhook({
      url,
      method,
      headers,
      signingSecrets,
      body,
      contentType,
      triggerName,
      testFire: true,
    });
    assertWebhookDelivered({ result, triggerName });
    return { status: result.status };
  },
  async sendSlackBot({ token, channel, payload }) {
    // The Web API surface — renders the gated chart/table/alert blocks. Posts to
    // a fixed, trusted host (slack.com) via the shared SSRF-fenced sender.
    await postSlackChatMessage({
      token,
      channel,
      payload,
      triggerName: "test fire",
    });
  },
};
