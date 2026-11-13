/**
 * The PII redaction metered price on a Growth subscription: provisioned per
 * Stripe mode by hand, so a checkout has to work where it resolves to nothing.
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */

import { describe, expect, it } from "vitest";

import {
  createCheckoutLineItems,
  pickGrowthPiiRedactionPriceId,
  type StripePriceMap,
} from "../index.ts";

const prices = {
  GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
  GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
  GROWTH_EVENTS_EUR_ANNUAL: "price_events_eur_annual",
  GROWTH_EVENTS_USD_MONTHLY: "price_events_usd_monthly",
  GROWTH_PII_REDACTION_USD: "price_pii_redaction_usd",
} as StripePriceMap;

describe("given a Stripe mode where the PII redaction price is provisioned", () => {
  describe("when a Growth checkout in dollars is built", () => {
    /** @scenario "A Growth checkout in dollars carries the PII redaction price" */
    it("carries the metered PII redaction item with no quantity", () => {
      const items = createCheckoutLineItems({
        coreMembers: 3,
        currency: "USD",
        interval: "monthly",
        prices,
      });

      expect(items).toEqual([
        { price: "price_seat_usd_monthly", quantity: 3 },
        { price: "price_events_usd_monthly" },
        // No quantity: Stripe aggregates the meter's own events.
        { price: "price_pii_redaction_usd" },
      ]);
    });
  });

  describe("when a Growth checkout in euros is built", () => {
    /** @scenario "A Growth checkout in euros carries no PII redaction price" */
    it("carries no PII redaction item, because the meter counts dollars", () => {
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
    it("answers for dollars and refuses for euros", () => {
      expect(pickGrowthPiiRedactionPriceId({ currency: "USD", prices })).toBe(
        "price_pii_redaction_usd",
      );
      expect(pickGrowthPiiRedactionPriceId({ currency: "EUR", prices })).toBeUndefined();
    });
  });
});

describe("given a Stripe mode whose catalog maps no PII redaction price", () => {
  describe("when a Growth checkout in dollars is built", () => {
    /** @scenario "A Growth checkout works where the PII redaction price is not provisioned" */
    it("carries the seat and events items only", () => {
      const { GROWTH_PII_REDACTION_USD: _unmapped, ...unprovisioned } = prices;

      const items = createCheckoutLineItems({
        coreMembers: 1,
        currency: "USD",
        interval: "monthly",
        prices: unprovisioned as StripePriceMap,
      });

      expect(items).toEqual([
        { price: "price_seat_usd_monthly", quantity: 1 },
        { price: "price_events_usd_monthly" },
      ]);
    });
  });
});
