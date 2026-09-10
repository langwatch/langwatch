import { BillingSubscriptionNotifier } from "../ports/subscription-notifier.port.ts";

/** Drops subscription notices where no delivery transport is composed. */
export class NullBillingSubscriptionNotifierAdapter extends BillingSubscriptionNotifier {
  private constructor() {
    super();
  }

  static create(): NullBillingSubscriptionNotifierAdapter {
    return new NullBillingSubscriptionNotifierAdapter();
  }

  async send(): Promise<void> {}
}
