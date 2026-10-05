import { BillingAlertChannel, type BillingAlertMessage } from "../billing-alert.channel.ts";

/** Records what billing would have posted to Slack, without a network call. */
export class MemoryBillingAlertChannel extends BillingAlertChannel {
  readonly sent: { webhookUrl: string; message: BillingAlertMessage }[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryBillingAlertChannel {
    return new MemoryBillingAlertChannel();
  }

  async send(input: { webhookUrl: string; message: BillingAlertMessage }): Promise<void> {
    this.sent.push(input);
  }
}
