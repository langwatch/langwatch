import { IncomingWebhook } from "@slack/webhook";

import { BillingSlackChannel, type BillingSlackMessage } from "../billing-slack.channel.ts";

const SLACK_TIMEOUT_MS = 10_000;

type SlackWebhook = Pick<IncomingWebhook, "send">;

export class SlackBillingSlackChannel extends BillingSlackChannel {
  private constructor(private readonly createWebhook: (url: string) => SlackWebhook) {
    super();
  }

  static create(
    options: { createWebhook?: (url: string) => SlackWebhook } = {},
  ): SlackBillingSlackChannel {
    return new SlackBillingSlackChannel(
      options.createWebhook ?? ((url) => new IncomingWebhook(url, { timeout: SLACK_TIMEOUT_MS })),
    );
  }

  async send({
    webhookUrl,
    message,
  }: {
    webhookUrl: string;
    message: BillingSlackMessage;
  }): Promise<void> {
    await this.createWebhook(webhookUrl).send(message);
  }
}
