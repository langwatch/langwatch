/**
 * The Instant Evals metered price on a Growth subscription: provisioned per
 * Stripe mode by hand, so the interesting case is the window where the name
 * resolves to nothing and a checkout still has to work.
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 * @see enterprise/modules/billing/specs/euro-usage-prices.feature
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
  GROWTH_SEAT_EUR_MONTHLY: "price_seat_eur_monthly",
  GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
  GROWTH_EVENTS_EUR_ANNUAL: "price_events_eur_annual",
  GROWTH_EVENTS_EUR_MONTHLY: "price_events_eur_monthly",
  GROWTH_EVENTS_USD_MONTHLY: "price_events_usd_monthly",
  GROWTH_INSTANT_EVAL_USD: "price_instant_eval_usd",
  GROWTH_INSTANT_EVAL_EUR: "price_instant_eval_eur",
} as StripePriceMap;

describe("given a Stripe mode where both currencies' Instant Evals prices are provisioned", () => {
  describe("when a Growth checkout in dollars is built", () => {
    /** @scenario "The meter is named langwatch_instant_eval_usd" */
    /** @scenario "A Growth checkout in dollars keeps the dollar Instant Evals and PII redaction prices" */
    it("carries the dollar Instant Evals item with no quantity, and no euro one", () => {
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
    /** @scenario "A Growth checkout in euros carries the euro Instant Evals and PII redaction prices" */
    it("carries the euro Instant Evals item with no quantity, and no dollar one", () => {
      const items = createCheckoutLineItems({
        coreMembers: 2,
        currency: "EUR",
        interval: "monthly",
        prices,
      });

      expect(items).toEqual([
        { price: "price_seat_eur_monthly", quantity: 2 },
        { price: "price_events_eur_monthly" },
        { price: "price_instant_eval_eur" },
      ]);
    });
  });

  describe("when the price is asked for directly", () => {
    it("answers each currency with its own price, and reports the mode provisioned", () => {
      expect(pickGrowthInstantEvalPriceId({ currency: "USD", prices })).toBe(
        "price_instant_eval_usd",
      );
      expect(pickGrowthInstantEvalPriceId({ currency: "EUR", prices })).toBe(
        "price_instant_eval_eur",
      );
      expect(isGrowthInstantEvalPriceProvisioned({ prices })).toBe(true);
    });
  });
});

describe("given a Stripe mode that maps only the dollar Instant Evals price", () => {
  const { GROWTH_INSTANT_EVAL_EUR: _unmapped, ...dollarsOnly } = prices;

  describe("when a Growth checkout in euros is built", () => {
    /** @scenario "A Growth checkout in euros works where the euro usage prices are not provisioned" */
    it("carries the seat and events items only", () => {
      const items = createCheckoutLineItems({
        coreMembers: 2,
        currency: "EUR",
        interval: "annual",
        prices: dollarsOnly as StripePriceMap,
      });

      expect(items).toEqual([
        { price: "price_seat_eur_annual", quantity: 2 },
        { price: "price_events_eur_annual" },
      ]);
    });
  });

  describe("when the euro price is asked for directly", () => {
    it("answers nothing rather than the dollar price", () => {
      expect(
        pickGrowthInstantEvalPriceId({ currency: "EUR", prices: dollarsOnly as StripePriceMap }),
      ).toBeUndefined();
    });
  });
});
