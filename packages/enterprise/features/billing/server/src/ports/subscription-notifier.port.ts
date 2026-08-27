import type { SubscriptionNotificationPayload } from "@langwatch/enterprise-billing-contract";

/** Runtime delivery seam for internal subscription notifications. */
export abstract class BillingSubscriptionNotifier {
  abstract send(payload: SubscriptionNotificationPayload): Promise<void>;
}

export class NullBillingSubscriptionNotifier extends BillingSubscriptionNotifier {
  private constructor() {
    super();
  }

  static create(): NullBillingSubscriptionNotifier {
    return new NullBillingSubscriptionNotifier();
  }

  async send(): Promise<void> {}
}
