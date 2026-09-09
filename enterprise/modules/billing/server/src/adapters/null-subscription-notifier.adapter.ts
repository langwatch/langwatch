import { BillingSubscriptionNotifierPort } from "../ports/subscription-notifier.port.ts";

/** Drops subscription notices where no delivery transport is composed. */
export class NullBillingSubscriptionNotifierAdapter extends BillingSubscriptionNotifierPort {
  private constructor() {
    super();
  }

  static create(): NullBillingSubscriptionNotifierAdapter {
    return new NullBillingSubscriptionNotifierAdapter();
  }

  async send(): Promise<void> {}
}
