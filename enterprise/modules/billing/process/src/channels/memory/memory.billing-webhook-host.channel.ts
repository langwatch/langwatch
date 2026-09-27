import { BillingWebhookHost } from "../billing-webhook-host.channel.ts";

/** A host that alerts nowhere. */
export class MemoryBillingWebhookHostChannel extends BillingWebhookHost {
  private constructor() {
    super();
  }

  static create(): MemoryBillingWebhookHostChannel {
    return new MemoryBillingWebhookHostChannel();
  }

  async sendSlackSubscriptionEvent(): Promise<void> {}
  async sendSlackBillingThresholdFailureAlert(): Promise<void> {}
}
