/**
 * The retention line on the current Growth plan card.
 * @see specs/billing/retention-at-upgrade.feature
 */
import { Currency } from "@langwatch/enterprise-billing-contract";
import { describe, expect, it } from "vitest";

import { getGrowthFeatures, growthRetentionFeature } from "../billing-plans.ts";

describe("getGrowthFeatures() retention line", () => {
  describe("when the organization keeps traces for 371 days", () => {
    /** @scenario "The plan card names the retention the organization keeps" */
    it("lists 1 year retention", () => {
      expect(getGrowthFeatures(Currency.EUR, 371)).toContain("1 year retention");
      expect(getGrowthFeatures(Currency.EUR, 371)).not.toContain("90 days retention");
    });
  });

  describe("when the retention has not loaded yet", () => {
    /** @scenario "The plan card says 90 days until the retention is known" */
    it("lists the 90 days Growth includes", () => {
      expect(getGrowthFeatures(Currency.USD)).toContain("90 days retention");
    });
  });

  describe("when the retention is not a Growth option", () => {
    it("names the days, or unlimited when kept forever", () => {
      expect(growthRetentionFeature(49)).toBe("49 days retention");
      expect(growthRetentionFeature(0)).toBe("Unlimited retention");
      expect(growthRetentionFeature(182)).toBe("180 days retention");
    });
  });
});
