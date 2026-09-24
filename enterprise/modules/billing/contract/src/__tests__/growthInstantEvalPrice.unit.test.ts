/**
 * The Instant Evals metered price on a Growth subscription: provisioned per
 * Stripe mode by hand, so the interesting case is the window where the name
 * resolves to nothing and a checkout still has to work.
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { describe, expect, it } from "vitest";

import {
  createCheckoutLineItems,
  isGrowthInstantEvalPriceProvisioned,
  pickGrowthInstantEvalPriceId,
  type StripePriceMap,
} from "../index.ts";

const prices = {
  GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
  GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
  GROWTH_EVENTS_EUR_ANNUAL: "price_events_eur_annual",
  GROWTH_EVENTS_USD_MONTHLY: "price_events_usd_monthly",
  GROWTH_INSTANT_EVAL_USD: "price_instant_eval_usd",
} as StripePriceMap;

describe("given a Stripe mode where the Instant Evals price is provisioned", () => {
  describe("when a Growth checkout in dollars is built", () => {
    /** @scenario "The meter is named langwatch_instant_eval_usd" */
    it("carries the metered Instant Evals item with no quantity", () => {
      const items = createCheckoutLineItems({
        coreMembers: 4,
        currency: "USD",
        interval: "monthly",
        prices,
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
        prices,
      });

      expect(items).toEqual([
        { price: "price_seat_eur_annual", quantity: 2 },
        { price: "price_events_eur_annual" },
      ]);
    });
  });

  describe("when the price is asked for directly", () => {
    it("answers for dollars, refuses for euros, and reports the mode provisioned", () => {
      expect(pickGrowthInstantEvalPriceId({ currency: "USD", prices })).toBe(
        "price_instant_eval_usd",
      );
      expect(pickGrowthInstantEvalPriceId({ currency: "EUR", prices })).toBeUndefined();
      expect(isGrowthInstantEvalPriceProvisioned({ prices })).toBe(true);
    });
  });
});
