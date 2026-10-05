import { IncomingWebhook } from "@slack/webhook";

import { BillingAlertChannel, type BillingAlertMessage } from "../billing-alert.channel.ts";

const SLACK_TIMEOUT_MS = 10_000;

type SlackWebhook = Pick<IncomingWebhook, "send">;

export class SlackBillingAlertChannel extends BillingAlertChannel {
  private constructor(private readonly createWebhook: (url: string) => SlackWebhook) {
    super();
  }

  static create(
    options: { createWebhook?: (url: string) => SlackWebhook } = {},
  ): SlackBillingAlertChannel {
    return new SlackBillingAlertChannel(
      options.createWebhook ?? ((url) => new IncomingWebhook(url, { timeout: SLACK_TIMEOUT_MS })),
    );
  }

  async send({
    webhookUrl,
    message,
  }: {
    webhookUrl: string;
    message: BillingAlertMessage;
  }): Promise<void> {
    await this.createWebhook(webhookUrl).send(message);
  }
}
