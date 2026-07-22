import {
  IncomingWebhook,
  type IncomingWebhookSendArguments,
} from "@slack/webhook";
import type { SlackPayload } from "@langwatch/automations/templating/renderSlack";
import {
  assertWebhookDelivered,
  type WebhookSender,
} from "../clients/http/webhook.client";
import { isSlackWebhookUrl } from "../clients/slack/webhook-guard";
import type { SlackWebApiClient } from "../clients/slack/web-api.client";

/** Sends a test-fire notification. Injected so the template service is
 *  testable without hitting SES/SendGrid or a real Slack webhook. */
export interface TriggerNotifier {
  sendEmail(args: {
    /** Single visible recipient (the LangWatch no-reply for production
     *  triggers). All actual recipients ride in `bcc` so they don't see each
     *  other and can't be enumerated by external mailing-list integrations. */
    to: string;
    bcc: string[];
    subject: string;
    html: string;
  }): Promise<void>;
  sendSlack(args: { webhook: string; payload: SlackPayload }): Promise<void>;
  /** Web API (bot-token) delivery — renders the gated Block Kit blocks. */
  sendSlackBot(args: {
    token: string;
    channel: string;
    payload: SlackPayload;
  }): Promise<void>;
  /** ADR-040 generic HTTP delivery — the SSRF-fenced webhook sender, with
   *  the test-fire header injected. Returns the real HTTP status so the
   *  author sees what their endpoint answered. */
  sendWebhook(args: {
    url: string;
    method: "POST" | "PUT" | "PATCH";
    headers: Record<string, string>;
    body: string;
    triggerName: string;
  }): Promise<{ status: number }>;
}

/** Outbound email port — the app backs it with its SES/SendGrid sender. */
export interface MailerPort {
  sendEmail(args: {
    to: string;
    bcc: string[];
    subject: string;
    html: string;
  }): Promise<void>;
}

/**
 * Production delivery for trigger test fires: the email path uses the
 * injected mailer, the Slack path posts the already-rendered payload (plain
 * `text` or allow-listed `blocks`) straight to the incoming webhook, and the
 * webhook/bot paths ride the injected app-configured senders.
 */
export function createLiveTriggerNotifier({
  mailer,
  webhookSender,
  slackWebApi,
}: {
  mailer: MailerPort;
  webhookSender: WebhookSender;
  slackWebApi: Pick<SlackWebApiClient, "postSlackChatMessage">;
}): TriggerNotifier {
  return {
    async sendEmail({ to, bcc, subject, html }) {
      await mailer.sendEmail({ to, bcc, subject, html });
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
      const result = await webhookSender.sendWebhook({
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
      // The Web API surface — renders the gated chart/table/alert blocks. Posts
      // to a fixed, trusted host (slack.com) via the shared SSRF-fenced sender.
      await slackWebApi.postSlackChatMessage({
        token,
        channel,
        payload,
        triggerName: "test fire",
      });
    },
  };
}
