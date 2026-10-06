import {
  isAnnualGrowthEventsPrice,
  type StripePriceMap,
} from "@langwatch/enterprise-billing-contract";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";

/**
 * Amount of accrued metered usage (in the subscription currency's minor unit — 750.00 USD
 * or EUR) at which Stripe automatically invoices and charges the customer, instead of
 * letting a year of event overage pile up into one renewal invoice.
 */
export const ANNUAL_EVENTS_BILLING_THRESHOLD = 75_000;

type ThresholdSubscriptions = Pick<
  StripeSubscriptionsChannel,
  "getSubscription" | "updateSubscription"
>;

type ThresholdResult = "applied" | "already_set" | "anchor_pinned" | "not_annual_events";

/**
 * Sets the billing threshold on a Stripe subscription that carries an annually-billed
 * events price. Monthly subscriptions (and anything without a Growth annual events item)
 * are left untouched.
 */
export class AnnualEventsBillingThresholdService {
  private constructor(
    private readonly subscriptions: ThresholdSubscriptions,
    private readonly prices: StripePriceMap,
  ) {}

  static create(options: {
    subscriptions: ThresholdSubscriptions;
    prices: StripePriceMap;
  }): AnnualEventsBillingThresholdService {
    return new AnnualEventsBillingThresholdService(options.subscriptions, options.prices);
  }

  async apply({
    stripeSubscriptionId,
    isDryRun = false,
  }: {
    stripeSubscriptionId: string;
    isDryRun?: boolean;
  }): Promise<ThresholdResult> {
    const subscription = await this.subscriptions.getSubscription({
      subscriptionId: stripeSubscriptionId,
    });

    const hasAnnualEventsItem = (subscription.items?.data ?? []).some((item) =>
      isAnnualGrowthEventsPrice(item.price.id, this.prices),
    );
    if (!hasAnnualEventsItem) {
      return "not_annual_events";
    }

    const existingThreshold = subscription.billing_thresholds;
    const existingAmount = existingThreshold?.amount_gte;

    if (existingAmount != null) {
      if (existingThreshold?.reset_billing_cycle_anchor !== true) {
        return "already_set";
      }

      // The amount was chosen deliberately — keep it. The anchor reset was
      // not: it would move the renewal date on every threshold invoice.
      if (!isDryRun) {
        await this.subscriptions.updateSubscription({
          subscriptionId: stripeSubscriptionId,
          params: {
            billing_thresholds: { amount_gte: existingAmount, reset_billing_cycle_anchor: false },
          },
        });
      }

      return "anchor_pinned";
    }

    if (!isDryRun) {
      await this.subscriptions.updateSubscription({
        subscriptionId: stripeSubscriptionId,
        params: {
          billing_thresholds: {
            amount_gte: ANNUAL_EVENTS_BILLING_THRESHOLD,
            // The billing anniversary must never move — threshold invoices
            // collect mid-cycle, the renewal date stays as sold.
            reset_billing_cycle_anchor: false,
          },
        },
      });
    }

    return "applied";
  }
}
