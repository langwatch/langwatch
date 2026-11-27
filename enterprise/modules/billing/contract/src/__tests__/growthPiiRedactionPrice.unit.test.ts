/**
 * The PII redaction metered price on a Growth subscription: provisioned per
 * Stripe mode by hand, so a checkout has to work where it resolves to nothing.
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 * @see enterprise/modules/billing/specs/euro-usage-prices.feature
 */

import { describe, expect, it } from "vitest";

import {
  createCheckoutLineItems,
  pickGrowthPiiRedactionPriceId,
  type StripePriceMap,
} from "../index.ts";

const prices = {
  GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
  GROWTH_SEAT_EUR_MONTHLY: "price_seat_eur_monthly",
  GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
  GROWTH_EVENTS_EUR_ANNUAL: "price_events_eur_annual",
  GROWTH_EVENTS_EUR_MONTHLY: "price_events_eur_monthly",
  GROWTH_EVENTS_USD_MONTHLY: "price_events_usd_monthly",
  GROWTH_PII_REDACTION_USD: "price_pii_redaction_usd",
  GROWTH_PII_REDACTION_EUR: "price_pii_redaction_eur",
} as StripePriceMap;

describe("given a Stripe mode where both currencies' PII redaction prices are provisioned", () => {
  describe("when a Growth checkout in dollars is built", () => {
    /** @scenario "A Growth checkout in dollars carries the PII redaction price" */
    /** @scenario "A Growth checkout in dollars keeps the dollar Instant Evals and PII redaction prices" */
    it("carries the dollar PII redaction item with no quantity, and no euro one", () => {
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
    /** @scenario "A Growth checkout in euros carries the euro Instant Evals and PII redaction prices" */
    it("carries the euro PII redaction item with no quantity, and no dollar one", () => {
      const items = createCheckoutLineItems({
        coreMembers: 2,
        currency: "EUR",
        interval: "monthly",
        prices,
      });

      expect(items).toEqual([
        { price: "price_seat_eur_monthly", quantity: 2 },
        { price: "price_events_eur_monthly" },
        { price: "price_pii_redaction_eur" },
      ]);
    });
  });

  describe("when the price is asked for directly", () => {
    it("answers each currency with its own price", () => {
      expect(pickGrowthPiiRedactionPriceId({ currency: "USD", prices })).toBe(
        "price_pii_redaction_usd",
      );
      expect(pickGrowthPiiRedactionPriceId({ currency: "EUR", prices })).toBe(
        "price_pii_redaction_eur",
      );
    });
  });
});

describe("given a Stripe mode whose catalog maps no PII redaction price", () => {
  const {
    GROWTH_PII_REDACTION_USD: _unmappedUsd,
    GROWTH_PII_REDACTION_EUR: _unmappedEur,
    ...unprovisioned
  } = prices;

  describe("when a Growth checkout in dollars is built", () => {
    /** @scenario "A Growth checkout works where the PII redaction price is not provisioned" */
    it("carries the seat and events items only", () => {
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

  describe("when a Growth checkout in euros is built", () => {
    /** @scenario "A Growth checkout in euros works where the euro usage prices are not provisioned" */
    it("carries the seat and events items only", () => {
      const items = createCheckoutLineItems({
        coreMembers: 1,
        currency: "EUR",
        interval: "annual",
        prices: unprovisioned as StripePriceMap,
      });

      expect(items).toEqual([
        { price: "price_seat_eur_annual", quantity: 1 },
        { price: "price_events_eur_annual" },
      ]);
    });
  });
});
