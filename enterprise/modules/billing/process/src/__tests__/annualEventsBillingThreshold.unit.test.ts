import type { StripePriceMap } from "@langwatch/enterprise-billing-contract";
import { describe, expect, it } from "vitest";

const prices = {
  GROWTH_SEAT_EUR_MONTHLY: "price_seat_eur_monthly",
  GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
  GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
  GROWTH_SEAT_USD_ANNUAL: "price_seat_usd_annual",
  GROWTH_EVENTS_EUR_MONTHLY: "price_events_eur_monthly",
  GROWTH_EVENTS_EUR_ANNUAL: "price_events_eur_annual",
  GROWTH_EVENTS_USD_MONTHLY: "price_events_usd_monthly",
  GROWTH_EVENTS_USD_ANNUAL: "price_events_usd_annual",
  GROWTH_EVENTS_EUR_MONTHLY_UNTIL_MAR_2026: "price_events_eur_monthly_until_mar_2026",
  GROWTH_EVENTS_EUR_ANNUAL_UNTIL_MAR_2026: "price_events_eur_annual_until_mar_2026",
  GROWTH_EVENTS_USD_MONTHLY_UNTIL_MAR_2026: "price_events_usd_monthly_until_mar_2026",
  GROWTH_EVENTS_USD_ANNUAL_UNTIL_MAR_2026: "price_events_usd_annual_until_mar_2026",
} as StripePriceMap;

import type Stripe from "stripe";

import { MemoryStripeSubscriptionsChannel } from "../channels/memory/memory.stripe-subscriptions.channel.ts";
import {
  ANNUAL_EVENTS_BILLING_THRESHOLD,
  AnnualEventsBillingThresholdService,
} from "../services/annual-events-billing-threshold.service.ts";

const applyThreshold = ({
  subscriptions,
  ...input
}: {
  subscriptions: MemoryStripeSubscriptionsChannel;
  stripeSubscriptionId: string;
  isDryRun?: boolean;
}) => AnnualEventsBillingThresholdService.create({ subscriptions, prices }).apply(input);

const makeStripeSubscription = ({
  priceIds,
  billingThresholds = null,
}: {
  priceIds: string[];
  billingThresholds?: {
    amount_gte: number;
    reset_billing_cycle_anchor?: boolean;
  } | null;
}) =>
  ({
    id: "sub_stripe_1",
    billing_thresholds: billingThresholds,
    items: { data: priceIds.map((id) => ({ price: { id } })) },
  }) as Stripe.Subscription;

/** The subscriptions twin holding one subscription; its `updates` are what Stripe was sent. */
const twinHolding = (subscription: Stripe.Subscription) => {
  const subscriptions = MemoryStripeSubscriptionsChannel.create();
  subscriptions.seed({ subscription });
  return subscriptions;
};

describe("applyThreshold", () => {
  describe("given a subscription carrying an annual events price", () => {
    /** @scenario An annual subscription gets a billing threshold after checkout completes */
    it("updates the subscription with the threshold, without moving the anchor", async () => {
      const subscriptions = twinHolding(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_annual", "price_events_usd_annual"],
        }),
      );

      const result = await applyThreshold({
        subscriptions,
        stripeSubscriptionId: "sub_stripe_1",
      });

      expect(result).toBe("applied");
      expect(subscriptions.updates).toEqual([
        {
          subscriptionId: "sub_stripe_1",
          params: {
            billing_thresholds: {
              amount_gte: ANNUAL_EVENTS_BILLING_THRESHOLD,
              reset_billing_cycle_anchor: false,
            },
          },
        },
      ]);
    });

    it("applies to grandfathered pre-March-2026 annual events prices", async () => {
      const subscriptions = twinHolding(
        makeStripeSubscription({
          priceIds: ["price_seat_eur_annual", "price_events_eur_annual_until_mar_2026"],
        }),
      );

      const result = await applyThreshold({
        subscriptions,
        stripeSubscriptionId: "sub_stripe_1",
      });

      expect(result).toBe("applied");
      expect(subscriptions.updates).toHaveLength(1);
    });
  });

  describe("given the threshold is already set", () => {
    /** @scenario Applying the threshold twice is a no-op */
    it("makes no update call", async () => {
      const subscriptions = twinHolding(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_annual", "price_events_usd_annual"],
          billingThresholds: { amount_gte: ANNUAL_EVENTS_BILLING_THRESHOLD },
        }),
      );

      const result = await applyThreshold({
        subscriptions,
        stripeSubscriptionId: "sub_stripe_1",
      });

      expect(result).toBe("already_set");
      expect(subscriptions.updates).toEqual([]);
    });
  });

  describe("given a threshold set by hand to a different amount", () => {
    /** @scenario A manually configured threshold amount is never replaced */
    it("preserves the existing amount and makes no update call", async () => {
      const subscriptions = twinHolding(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_annual", "price_events_usd_annual"],
          billingThresholds: { amount_gte: 120_000 },
        }),
      );

      const result = await applyThreshold({
        subscriptions,
        stripeSubscriptionId: "sub_stripe_1",
      });

      expect(result).toBe("already_set");
      expect(subscriptions.updates).toEqual([]);
    });
  });

  describe("given a threshold that resets the billing cycle anchor", () => {
    /** @scenario A threshold configured to move the billing anniversary is corrected */
    it("pins the anchor while keeping the existing amount", async () => {
      const subscriptions = twinHolding(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_annual", "price_events_usd_annual"],
          billingThresholds: {
            amount_gte: 120_000,
            reset_billing_cycle_anchor: true,
          },
        }),
      );

      const result = await applyThreshold({
        subscriptions,
        stripeSubscriptionId: "sub_stripe_1",
      });

      expect(result).toBe("anchor_pinned");
      expect(subscriptions.updates).toEqual([
        {
          subscriptionId: "sub_stripe_1",
          params: {
            billing_thresholds: {
              amount_gte: 120_000,
              reset_billing_cycle_anchor: false,
            },
          },
        },
      ]);
    });

    it("reports without updating in dry-run mode", async () => {
      const subscriptions = twinHolding(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_annual", "price_events_usd_annual"],
          billingThresholds: {
            amount_gte: 120_000,
            reset_billing_cycle_anchor: true,
          },
        }),
      );

      const result = await applyThreshold({
        subscriptions,
        stripeSubscriptionId: "sub_stripe_1",
        isDryRun: true,
      });

      expect(result).toBe("anchor_pinned");
      expect(subscriptions.updates).toEqual([]);
    });
  });

  describe("given a subscription with no annual events price", () => {
    it("skips monthly and non-Growth subscriptions untouched", async () => {
      const monthly = twinHolding(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_monthly", "price_events_usd_monthly"],
        }),
      );
      const nonGrowth = twinHolding(makeStripeSubscription({ priceIds: ["price_something_else"] }));

      await expect(
        applyThreshold({
          subscriptions: monthly,
          stripeSubscriptionId: "sub_stripe_1",
        }),
      ).resolves.toBe("not_annual_events");
      await expect(
        applyThreshold({
          subscriptions: nonGrowth,
          stripeSubscriptionId: "sub_stripe_1",
        }),
      ).resolves.toBe("not_annual_events");

      expect(monthly.updates).toEqual([]);
      expect(nonGrowth.updates).toEqual([]);
    });
  });

  describe("given dry-run mode", () => {
    it("reports applied without updating the subscription", async () => {
      const subscriptions = twinHolding(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_annual", "price_events_usd_annual"],
        }),
      );

      const result = await applyThreshold({
        subscriptions,
        stripeSubscriptionId: "sub_stripe_1",
        isDryRun: true,
      });

      expect(result).toBe("applied");
      expect(subscriptions.updates).toEqual([]);
    });
  });
});
