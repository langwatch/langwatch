import { createSlackIncomingWebhookSender } from "@langwatch/automations-server/clients/slack/incoming-webhook.client";
import { env } from "~/env.mjs";

/** The app-configured legacy-format Slack notifier (ADR-063 §1) — the
 *  package renders and sends; the app contributes its public origin. */
export const { sendSlackWebhook } = createSlackIncomingWebhookSender({
  baseHost: env.BASE_HOST,
});
