import { BillingSubscriptionNotifierPort } from "../ports/subscription-notifier.port";

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
