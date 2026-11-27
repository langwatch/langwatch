/**
 * The euro usage prices sit on the dollar meters at a fixed 0.85 of the dollar price, so a
 * catalogue that maps one at any other amount, currency or interval is refused.
 * @see enterprise/modules/billing/specs/euro-usage-prices.feature
 */

import { describe, expect, it } from "vitest";

import {
  euroUsagePriceErrors,
  GROWTH_USAGE_EUR_PER_USD,
  parseStripePricesFile,
  type StripePriceDetail,
  type StripePricesFile,
} from "../index.ts";
import stripeCatalogData from "../stripe-catalog.json";

const committed = parseStripePricesFile(stripeCatalogData);

const usdInstantEvalId = committed.mapping.GROWTH_INSTANT_EVAL_USD?.test ?? "";

/** The committed catalogue with a euro Instant Evals price mapped in test mode. */
function withEuroInstantEvalPrice(detail: Partial<StripePriceDetail>): StripePricesFile {
  const euro: StripePriceDetail = {
    id: "price_instant_eval_eur_test",
    active: true,
    livemode: false,
    product: "prod_instant_eval",
    unitAmount: 85,
    currency: "eur",
    type: "recurring",
    recurring: { interval: "month", intervalCount: 1 },
    nickname: "Growth Instant Evals, 0.85 EUR per USD judged",
    lookupKey: "GROWTH_INSTANT_EVAL_EUR",
    metadata: { langwatch_key: "GROWTH_INSTANT_EVAL_EUR" },
    ...detail,
  };
  return {
    ...committed,
    mapping: { ...committed.mapping, GROWTH_INSTANT_EVAL_EUR: { test: euro.id } },
    prices: { ...committed.prices, [euro.id]: euro },
  };
}

describe("euroUsagePriceErrors()", () => {
  /** @scenario "A mapped euro usage price costs 0.85 of its dollar price" */
  it("is the seat ratio, EUR 29 to USD 34 rounded to 0.85", () => {
    expect(GROWTH_USAGE_EUR_PER_USD).toBe(0.85);
  });

  describe("given the committed catalogue", () => {
    /** @scenario "A mapped euro usage price costs 0.85 of its dollar price" */
    it.each(["test", "live"] as const)("finds nothing wrong in %s mode", (environment) => {
      expect(euroUsagePriceErrors({ file: committed, environment })).toEqual([]);
    });
  });

  describe("given a euro Instant Evals price at 85 euro cents beside the 100 cent dollar one", () => {
    /** @scenario "A mapped euro usage price costs 0.85 of its dollar price" */
    it("accepts it", () => {
      expect(committed.prices[usdInstantEvalId]?.unitAmount).toBe(100);
      expect(
        euroUsagePriceErrors({ file: withEuroInstantEvalPrice({}), environment: "test" }),
      ).toEqual([]);
    });
  });

  describe("given a euro price that drifted from the ratio", () => {
    /** @scenario "A mapped euro usage price costs 0.85 of its dollar price" */
    it.each([
      ["another amount", { unitAmount: 100 }],
      ["dollars", { currency: "usd" }],
      ["an annual interval", { recurring: { interval: "year" as const, intervalCount: 1 } }],
    ])("refuses one in %s, naming it", (_case, detail) => {
      const errors = euroUsagePriceErrors({
        file: withEuroInstantEvalPrice(detail),
        environment: "test",
      });

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("GROWTH_INSTANT_EVAL_EUR");
    });
  });

  describe("given a euro price mapped where its dollar price is not", () => {
    /** @scenario "A euro usage price mapped without its dollar price is refused" */
    it("refuses it, since there is no dollar price to follow", () => {
      const file = withEuroInstantEvalPrice({});
      const { GROWTH_INSTANT_EVAL_USD: _unmapped, ...mapping } = file.mapping;

      const errors = euroUsagePriceErrors({
        file: { ...file, mapping: mapping as StripePricesFile["mapping"] },
        environment: "test",
      });

      expect(errors).toEqual([expect.stringContaining("GROWTH_INSTANT_EVAL_EUR")]);
    });
  });
});
