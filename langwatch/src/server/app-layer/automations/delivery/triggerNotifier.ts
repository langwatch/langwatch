import {
  IncomingWebhook,
  type IncomingWebhookSendArguments,
} from "@slack/webhook";
import type { TriggerNotifier } from "~/server/app-layer/automations/trigger-template.service";
import { sendEmail } from "~/server/mailer/emailSender";
import { assertWebhookDelivered, sendWebhook } from "./sendWebhook";
import { isSlackWebhookUrl } from "@langwatch/automations-server/clients/slack/webhook-guard";
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
  async sendWebhook({ url, method, headers, body, triggerName }) {
    // The full SSRF-fenced sender — same path a real fire takes — with the
    // non-suppressible test-fire marker header (ADR-040 §1). Non-2xx throws
    // the classified DispatchError so the author sees what the endpoint said.
    const result = await sendWebhook({
      url,
      method,
      headers,
      body,
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
