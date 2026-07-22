import { createLiveTriggerNotifier } from "@langwatch/automations-server/dispatch/notifier";
import { sendEmail } from "~/server/mailer/emailSender";
import { postSlackChatMessage } from "./appSlackWebApi";
import { sendWebhook } from "./appWebhookSender";

/** The app-composed test-fire notifier (ADR-063 §1): package logic over the
 *  app's mailer and its configured webhook / Slack Web API senders. */
export const liveTriggerNotifier = createLiveTriggerNotifier({
  mailer: { sendEmail },
  webhookSender: { sendWebhook },
  slackWebApi: { postSlackChatMessage },
});
