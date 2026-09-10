import { BillingWebhookHost } from "../billing-webhook-host.channel.ts";

/** A host that alerts nowhere and writes no retention default. */
export class MemoryBillingWebhookHostChannel extends BillingWebhookHost {
  async sendSlackSubscriptionEvent(): Promise<void> {}
  async sendSlackBillingThresholdFailureAlert(): Promise<void> {}
  async listOrganizationRetentionRules(): Promise<
    Array<{ scopeType: string; scopeId: string; category: string }>
  > {
    return [];
  }
  async setOrganizationRetention(): Promise<void> {}
}
