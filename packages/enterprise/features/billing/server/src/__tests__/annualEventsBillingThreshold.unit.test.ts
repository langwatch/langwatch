import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StripePriceMap } from "@langwatch/enterprise-billing-contract";

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
import { ANNUAL_EVENTS_BILLING_THRESHOLD, AnnualEventsBillingThresholdService } from "../index";

const applyThreshold = ({
  stripe,
  ...input
}: {
  stripe: Stripe;
  stripeSubscriptionId: string;
  isDryRun?: boolean;
}) => AnnualEventsBillingThresholdService.create({ stripe, prices }).apply(input);

const makeStripeSubscription = ({
  priceIds,
  billingThresholds = null,
}: {
  priceIds: string[];
  billingThresholds?: {
    amount_gte: number;
    reset_billing_cycle_anchor?: boolean;
  } | null;
}) => ({
  id: "sub_stripe_1",
  billing_thresholds: billingThresholds,
  items: { data: priceIds.map((id) => ({ price: { id } })) },
});

const makeStripe = (subscription: unknown) =>
  ({
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue(subscription),
      update: vi.fn().mockResolvedValue({}),
    },
  }) as unknown as Stripe & {
    subscriptions: {
      retrieve: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

describe("applyThreshold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a subscription carrying an annual events price", () => {
    /** @scenario An annual subscription gets a billing threshold after checkout completes */
    it("updates the subscription with the threshold, without moving the anchor", async () => {
      const stripe = makeStripe(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_annual", "price_events_usd_annual"],
        }),
      );

      const result = await applyThreshold({
        stripe,
        stripeSubscriptionId: "sub_stripe_1",
      });

      expect(result).toBe("applied");
      expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_stripe_1", {
        billing_thresholds: {
          amount_gte: ANNUAL_EVENTS_BILLING_THRESHOLD,
          reset_billing_cycle_anchor: false,
        },
      });
    });

    it("applies to grandfathered pre-March-2026 annual events prices", async () => {
      const stripe = makeStripe(
        makeStripeSubscription({
          priceIds: ["price_seat_eur_annual", "price_events_eur_annual_until_mar_2026"],
        }),
      );

      const result = await applyThreshold({
        stripe,
        stripeSubscriptionId: "sub_stripe_1",
      });

      expect(result).toBe("applied");
      expect(stripe.subscriptions.update).toHaveBeenCalled();
    });
  });

  describe("given the threshold is already set", () => {
    /** @scenario Applying the threshold twice is a no-op */
    it("makes no update call", async () => {
      const stripe = makeStripe(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_annual", "price_events_usd_annual"],
          billingThresholds: { amount_gte: ANNUAL_EVENTS_BILLING_THRESHOLD },
        }),
      );

      const result = await applyThreshold({
        stripe,
        stripeSubscriptionId: "sub_stripe_1",
      });

      expect(result).toBe("already_set");
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe("given a threshold set by hand to a different amount", () => {
    /** @scenario A manually configured threshold amount is never replaced */
    it("preserves the existing amount and makes no update call", async () => {
      const stripe = makeStripe(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_annual", "price_events_usd_annual"],
          billingThresholds: { amount_gte: 120_000 },
        }),
      );

      const result = await applyThreshold({
        stripe,
        stripeSubscriptionId: "sub_stripe_1",
      });

      expect(result).toBe("already_set");
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe("given a threshold that resets the billing cycle anchor", () => {
    /** @scenario A threshold configured to move the billing anniversary is corrected */
    it("pins the anchor while keeping the existing amount", async () => {
      const stripe = makeStripe(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_annual", "price_events_usd_annual"],
          billingThresholds: {
            amount_gte: 120_000,
            reset_billing_cycle_anchor: true,
          },
        }),
      );

      const result = await applyThreshold({
        stripe,
        stripeSubscriptionId: "sub_stripe_1",
      });

      expect(result).toBe("anchor_pinned");
      expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_stripe_1", {
        billing_thresholds: {
          amount_gte: 120_000,
          reset_billing_cycle_anchor: false,
        },
      });
    });

    it("reports without updating in dry-run mode", async () => {
      const stripe = makeStripe(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_annual", "price_events_usd_annual"],
          billingThresholds: {
            amount_gte: 120_000,
            reset_billing_cycle_anchor: true,
          },
        }),
      );

      const result = await applyThreshold({
        stripe,
        stripeSubscriptionId: "sub_stripe_1",
        isDryRun: true,
      });

      expect(result).toBe("anchor_pinned");
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe("given a subscription with no annual events price", () => {
    it("skips monthly and non-Growth subscriptions untouched", async () => {
      const monthly = makeStripe(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_monthly", "price_events_usd_monthly"],
        }),
      );
      const nonGrowth = makeStripe(makeStripeSubscription({ priceIds: ["price_something_else"] }));

      await expect(
        applyThreshold({
          stripe: monthly,
          stripeSubscriptionId: "sub_stripe_1",
        }),
      ).resolves.toBe("not_annual_events");
      await expect(
        applyThreshold({
          stripe: nonGrowth,
          stripeSubscriptionId: "sub_stripe_1",
        }),
      ).resolves.toBe("not_annual_events");

      expect(monthly.subscriptions.update).not.toHaveBeenCalled();
      expect(nonGrowth.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe("given dry-run mode", () => {
    it("reports applied without calling Stripe", async () => {
      const stripe = makeStripe(
        makeStripeSubscription({
          priceIds: ["price_seat_usd_annual", "price_events_usd_annual"],
        }),
      );

      const result = await applyThreshold({
        stripe,
        stripeSubscriptionId: "sub_stripe_1",
        isDryRun: true,
      });

      expect(result).toBe("applied");
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });
});
