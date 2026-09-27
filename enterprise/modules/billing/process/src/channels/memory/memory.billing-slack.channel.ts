import { BillingSlackChannel, type BillingSlackMessage } from "../billing-slack.channel.ts";

/** Records what billing would have posted to Slack, without a network call. */
export class MemoryBillingSlackChannel extends BillingSlackChannel {
  readonly sent: { webhookUrl: string; message: BillingSlackMessage }[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryBillingSlackChannel {
    return new MemoryBillingSlackChannel();
  }

  async send(input: { webhookUrl: string; message: BillingSlackMessage }): Promise<void> {
    this.sent.push(input);
  }
}
