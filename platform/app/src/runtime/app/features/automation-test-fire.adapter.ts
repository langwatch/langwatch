import type {
  TestFireEmail,
  TestFireSlackBot,
  TestFireSlackWebhook,
  TestFireWebhook,
} from "@langwatch/automation-server";
import { AutomationTestFirePort } from "@langwatch/automation-server";
import { computeDefaultFrom, sendEmail } from "~/server/mailer/emailSender";
import type { EmailDeliveryPort } from "~/server/mailer/providers/types";
import {
  buildTriggerNoReplyAddress,
  TEST_FIRE_TRIGGER_ID_SENTINEL,
} from "~/server/mailer/triggerNoReply";
import { assertWebhookDelivered, sendWebhook } from "~/server/webhooks/sendWebhook";
import { isSlackWebhookUrl } from "@langwatch/automation-contract";
import { postSlackChatMessage } from "~/runtime/app/features/automation-adapters/delivery/slackWebApi";
import { AppSlackWebhookClientAdapter } from "~/runtime/app/features/automation-adapters/delivery/slack-webhook.client.adapter";

export class AppAutomationTestFireAdapter extends AutomationTestFirePort {
  private constructor(
    private readonly mailer: EmailDeliveryPort,
    private readonly slackWebhook: AppSlackWebhookClientAdapter,
  ) {
    super();
  }

  static create(
    mailer: EmailDeliveryPort,
    slackWebhook = AppSlackWebhookClientAdapter.create(),
  ): AppAutomationTestFireAdapter {
    return new AppAutomationTestFireAdapter(mailer, slackWebhook);
  }

  async sendEmail(input: TestFireEmail): Promise<void> {
    const to = buildTriggerNoReplyAddress({
      defaultFrom: computeDefaultFrom(this.mailer),
      triggerId: TEST_FIRE_TRIGGER_ID_SENTINEL,
    });

    await sendEmail({
      mailer: this.mailer,
      content: { to, bcc: input.recipients, subject: input.subject, html: input.html },
    });
  }

  async sendSlack(input: TestFireSlackWebhook): Promise<void> {
    if (!isSlackWebhookUrl(input.webhook)) {
      throw new Error("Slack webhook must be a valid https://hooks.slack.com/ URL.");
    }

    await this.slackWebhook.send({
      webhook: input.webhook,
      payload: input.payload,
    });
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
