/**
 * Unit tests for currency-aware pricing strings in billing-plans.
 *
 * Verifies that getGrowthFeatures() and getGrowthPlanFeatures() produce
 * the correct per-100K events pricing line for each supported currency.
 */
import { describe, expect, it } from "vitest";
import { Currency } from "@prisma/client";
import { getGrowthFeatures, getGrowthPlanFeatures } from "../billing-plans";

describe("getGrowthFeatures()", () => {
  describe("when currency is EUR", () => {
    it("contains the EUR events pricing string", () => {
      const features = getGrowthFeatures(Currency.EUR);

      expect(features).toContain("\u20AC5 per additional 100,000 events");
    });
  });

  describe("when currency is USD", () => {
    it("contains the USD events pricing string", () => {
      const features = getGrowthFeatures(Currency.USD);

      expect(features).toContain("$6 per additional 100,000 events");
    });
  });
});

describe("getGrowthPlanFeatures()", () => {
  describe("when currency is EUR", () => {
    it("contains the EUR events pricing string", () => {
      const features = getGrowthPlanFeatures(Currency.EUR);

      expect(features).toContain("\u20AC5 per additional 100,000 events");
    });
  });

  describe("when currency is USD", () => {
    it("contains the USD events pricing string", () => {
      const features = getGrowthPlanFeatures(Currency.USD);

      expect(features).toContain("$6 per additional 100,000 events");
    });
  });
});
