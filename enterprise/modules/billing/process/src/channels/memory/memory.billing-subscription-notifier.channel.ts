import { BillingSubscriptionNotifier } from "../billing-subscription-notifier.channel.ts";

/** Drops subscription notices where no delivery transport is composed. */
export class MemoryBillingSubscriptionNotifierChannel extends BillingSubscriptionNotifier {
  private constructor() {
    super();
  }

  static create(): MemoryBillingSubscriptionNotifierChannel {
    return new MemoryBillingSubscriptionNotifierChannel();
  }

  async send(): Promise<void> {}
}
