import type {
  TestFireEmail,
  TestFireSlackBot,
  TestFireSlackWebhook,
  TestFireWebhook,
} from "@langwatch/automation-server";
import { AutomationTestFirePort } from "@langwatch/automation-server";
import { IncomingWebhook, type IncomingWebhookSendArguments } from "@slack/webhook";
import { computeDefaultFrom, sendEmail } from "~/server/mailer/emailSender";
import {
  buildTriggerNoReplyAddress,
  TEST_FIRE_TRIGGER_ID_SENTINEL,
} from "~/server/mailer/triggerNoReply";
import { assertWebhookDelivered, sendWebhook } from "~/server/webhooks/sendWebhook";
import { isSlackWebhookUrl } from "@langwatch/automation-contract";
import { postSlackChatMessage } from "~/server/app-layer/automations/delivery/slackWebApi";

export class AppAutomationTestFireAdapter extends AutomationTestFirePort {
  private constructor() {
    super();
  }

  static create(): AppAutomationTestFireAdapter {
    return new AppAutomationTestFireAdapter();
  }

  async sendEmail(input: TestFireEmail): Promise<void> {
    const to = buildTriggerNoReplyAddress({
      defaultFrom: computeDefaultFrom(),
      triggerId: TEST_FIRE_TRIGGER_ID_SENTINEL,
    });

    await sendEmail({
      to,
      bcc: input.recipients,
      subject: input.subject,
      html: input.html,
    });
  }

  async sendSlack(input: TestFireSlackWebhook): Promise<void> {
    if (!isSlackWebhookUrl(input.webhook)) {
      throw new Error("Slack webhook must be a valid https://hooks.slack.com/ URL.");
    }

    await new IncomingWebhook(input.webhook).send(
      input.payload as IncomingWebhookSendArguments,
    );
  }

  async sendSlackBot(input: TestFireSlackBot): Promise<void> {
    await postSlackChatMessage({
      token: input.token,
      channel: input.channel,
      payload: input.payload,
      triggerName: "test fire",
    });
  }

  async sendWebhook(input: TestFireWebhook): Promise<{ status: number }> {
    const result = await sendWebhook({
      ...input,
      testFire: true,
    });
    assertWebhookDelivered({ result, triggerName: input.triggerName });
    return { status: result.status };
  }
}
