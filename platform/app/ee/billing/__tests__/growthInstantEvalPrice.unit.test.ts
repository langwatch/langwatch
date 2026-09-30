/**
 * The Instant Evals metered price on a Growth subscription.
 *
 * Its meter and price are provisioned in Stripe per mode by hand, so the
 * interesting case is not the happy one: it is the window between this code
 * landing and that provisioning, where the name resolves to nothing. A Growth
 * checkout has to keep working through that window, because failing it would
 * block every Growth signup over a meter for a separate feature.
 *
 * @see ../utils/growthSeatEvent.ts
 * @see ../../../../specs/instant-evals/instant-eval-billing.feature
 */

import { describe, expect, it, vi } from "vitest";

// Inline rather than a named constant: vi.mock is hoisted above every
// declaration in the file, so a factory that closes over one throws.
vi.mock("../stripe/stripePriceCatalog", () => ({
  prices: {
    GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
    GROWTH_SEAT_USD_ANNUAL: "price_seat_usd_annual",
    GROWTH_SEAT_EUR_MONTHLY: "price_seat_eur_monthly",
    GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
    GROWTH_EVENTS_USD_MONTHLY: "price_events_usd_monthly",
    GROWTH_EVENTS_USD_ANNUAL: "price_events_usd_annual",
    GROWTH_EVENTS_EUR_MONTHLY: "price_events_eur_monthly",
    GROWTH_EVENTS_EUR_ANNUAL: "price_events_eur_annual",
    GROWTH_INSTANT_EVAL_USD: "price_instant_eval_usd",
  },
}));

import {
  createCheckoutLineItems,
  isGrowthInstantEvalPriceProvisioned,
  resolveGrowthInstantEvalPriceId,
} from "../utils/growthSeatEvent";

describe("given a Stripe mode where the Instant Evals price is provisioned", () => {
  describe("when a Growth checkout in dollars is built", () => {
    it("carries the metered Instant Evals item with no quantity", () => {
      const items = createCheckoutLineItems({
        coreMembers: 4,
        currency: "USD",
        interval: "monthly",
      });

      expect(items).toEqual([
        { price: "price_seat_usd_monthly", quantity: 4 },
        { price: "price_events_usd_monthly" },
        // No quantity: Stripe aggregates the meter's own events.
        { price: "price_instant_eval_usd" },
      ]);
    });
  });

  describe("when a Growth checkout in euros is built", () => {
    it("carries no Instant Evals item, because the price is dollars only", () => {
      const items = createCheckoutLineItems({
        coreMembers: 2,
        currency: "EUR",
        interval: "annual",
      });

      expect(items).toEqual([
        { price: "price_seat_eur_annual", quantity: 2 },
        { price: "price_events_eur_annual" },
      ]);
    });
  });

  describe("when the price is asked for directly", () => {
    it("answers for dollars and refuses for euros", () => {
      expect(resolveGrowthInstantEvalPriceId({ currency: "USD" })).toBe(
        "price_instant_eval_usd",
      );
      expect(
        resolveGrowthInstantEvalPriceId({ currency: "EUR" }),
      ).toBeUndefined();
    });

    it("reports the mode as provisioned", () => {
      expect(isGrowthInstantEvalPriceProvisioned()).toBe(true);
    });
  });
});
