import type Stripe from "stripe";
import { isAnnualGrowthEventsPrice } from "../utils/growthSeatEvent";

/**
 * Amount of accrued metered usage (in the subscription currency's minor
 * unit — 750.00 USD or EUR) at which Stripe automatically invoices and
 * charges the customer, instead of letting a year of event overage pile
 * up into one renewal invoice. Threshold invoices keep the cumulative
 * annual included-events quota intact; only collection timing changes.
 */
export const ANNUAL_EVENTS_BILLING_THRESHOLD = 75_000;

export type ThresholdResult = "applied" | "already_set" | "not_annual_events";

/**
 * Sets the billing threshold on a Stripe subscription that carries an
 * annually-billed events price. Idempotent: re-applying an already-set
 * threshold makes no update call. Monthly subscriptions (and anything
 * without a Growth annual events item) are left untouched.
 *
 * This cannot happen at checkout — Stripe Checkout rejects
 * `subscription_data[billing_thresholds]` — so callers apply it right
 * after the subscription exists (checkout-completed webhook) or via the
 * backfill script for pre-existing subscriptions.
 */
export const applyAnnualEventsBillingThreshold = async ({
  stripe,
  stripeSubscriptionId,
  dryRun = false,
}: {
  stripe: Stripe;
  stripeSubscriptionId: string;
  dryRun?: boolean;
}): Promise<ThresholdResult> => {
  const subscription =
    await stripe.subscriptions.retrieve(stripeSubscriptionId);

  const hasAnnualEventsItem = (subscription.items?.data ?? []).some((item) =>
    isAnnualGrowthEventsPrice(item.price.id),
  );
  if (!hasAnnualEventsItem) {
    return "not_annual_events";
  }

  if (
    subscription.billing_thresholds?.amount_gte ===
    ANNUAL_EVENTS_BILLING_THRESHOLD
  ) {
    return "already_set";
  }

  if (!dryRun) {
    await stripe.subscriptions.update(stripeSubscriptionId, {
      billing_thresholds: {
        amount_gte: ANNUAL_EVENTS_BILLING_THRESHOLD,
        // The billing anniversary must never move — threshold invoices
        // collect mid-cycle, the renewal date stays as sold.
        reset_billing_cycle_anchor: false,
      },
    });
  }

  return "applied";
};
