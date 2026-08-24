import type Stripe from "stripe";
import {
  isAnnualGrowthEventsPrice,
  type StripePriceMap,
} from "@langwatch/enterprise-billing-contract";

/**
 * Amount of accrued metered usage (in the subscription currency's minor
 * unit — 750.00 USD or EUR) at which Stripe automatically invoices and
 * charges the customer, instead of letting a year of event overage pile
 * up into one renewal invoice. Threshold invoices keep the cumulative
 * annual included-events quota intact; only collection timing changes.
 *
 * Changing this constant only affects subscriptions that have no
 * threshold yet: an existing threshold — whatever its amount — is
 * preserved (see below), so already-configured subscriptions keep their
 * value until someone deliberately changes it in Stripe.
 */
export const ANNUAL_EVENTS_BILLING_THRESHOLD = 75_000;

export type ThresholdResult =
  | "applied"
  | "already_set"
  | "anchor_pinned"
  | "not_annual_events";

/**
 * Sets the billing threshold on a Stripe subscription that carries an
 * annually-billed events price. Monthly subscriptions (and anything
 * without a Growth annual events item) are left untouched.
 *
 * Preserve-over-normalize: a subscription that already carries a
 * threshold keeps its amount, even when it differs from the default —
 * a value someone set by hand (e.g. negotiated per customer) is never
 * silently replaced. The one exception is `reset_billing_cycle_anchor:
 * true`, which would move the billing anniversary on every threshold
 * invoice: that contradicts what the customer was sold, so it is
 * corrected to `false` while keeping the existing amount
 * (`anchor_pinned`).
 *
 * This cannot happen at checkout — Stripe Checkout rejects
 * `subscription_data[billing_thresholds]` — so it is applied right after
 * the subscription exists, from the checkout-completed webhook. That is
 * the only caller in this repo, and it covers new subscriptions only.
 *
 * `isDryRun` therefore has no caller here, and that is deliberate rather
 * than leftover. The one-time backfill over pre-existing subscriptions
 * walks live Stripe billing data for current customers — SaaS-only
 * operational work that does not belong in this repo — and is not
 * written yet: it is sequenced after this merge, because it imports this
 * function and the langwatch submodule in langwatch-saas has to be
 * bumped past that merge before the import resolves. Its safety story is
 * a dry-run preview of the blast radius, so the flag is the seam that
 * caller will use. Do not delete it as dead code.
 *
 * Note on `items`: Stripe returns it as a paginated list (default 10).
 * A Growth subscription carries exactly two items (seat + events, see
 * `createCheckoutLineItems`), so the first page always holds them. If a
 * plan ever grows past ten line items this needs to page, or it will
 * silently read as `not_annual_events` and skip the threshold.
 */
export class AnnualEventsBillingThresholdService {
  private constructor(
    private readonly stripe: Stripe,
    private readonly prices: StripePriceMap,
  ) {}

  static create(options: {
    stripe: Stripe;
    prices: StripePriceMap;
  }): AnnualEventsBillingThresholdService {
    return new AnnualEventsBillingThresholdService(options.stripe, options.prices);
  }

  async apply({
    stripeSubscriptionId,
    isDryRun = false,
  }: {
    stripeSubscriptionId: string;
    isDryRun?: boolean;
  }): Promise<ThresholdResult> {
  const subscription =
    await this.stripe.subscriptions.retrieve(stripeSubscriptionId);

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
      await this.stripe.subscriptions.update(stripeSubscriptionId, {
        billing_thresholds: {
          amount_gte: existingAmount,
          reset_billing_cycle_anchor: false,
        },
      });
    }
    return "anchor_pinned";
  }

  if (!isDryRun) {
    await this.stripe.subscriptions.update(stripeSubscriptionId, {
      billing_thresholds: {
        amount_gte: ANNUAL_EVENTS_BILLING_THRESHOLD,
        // The billing anniversary must never move — threshold invoices
        // collect mid-cycle, the renewal date stays as sold.
        reset_billing_cycle_anchor: false,
      },
    });
  }

  return "applied";
  }
}
