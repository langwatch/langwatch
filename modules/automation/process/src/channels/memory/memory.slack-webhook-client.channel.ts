import type { SlackWebhookClientChannel } from "../slack/slack.webhook-client.channel.ts";

type SlackWebhookSend = Parameters<SlackWebhookClientChannel["send"]>[0];

/** Records each incoming-webhook send instead of reaching Slack. */
export class MemorySlackWebhookClientChannel implements Pick<SlackWebhookClientChannel, "send"> {
  static create(): MemorySlackWebhookClientChannel {
    return new MemorySlackWebhookClientChannel();
  }

  readonly sent: SlackWebhookSend[] = [];

  private constructor() {}

  async send(input: SlackWebhookSend): Promise<void> {
    this.sent.push(input);
  }
}
