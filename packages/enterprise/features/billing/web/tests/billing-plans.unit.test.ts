/**
 * Unit tests for currency-aware pricing strings in billing-plans.
 *
 * Verifies that getGrowthFeatures() and getGrowthPlanFeatures() produce
 * the correct per-100K events pricing line for each supported currency.
 */

import { describe, expect, it } from "vitest";
import { Currency } from "@langwatch/enterprise-billing-contract";
import {
  buildEnterprisePlanFeatures,
  ENTERPRISE_PLAN_FEATURES,
  getGrowthFeatures,
  getGrowthPlanFeatures,
  WEBHOOK_FEATURE_LABEL,
} from "../src/billing-plans";

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

describe("buildEnterprisePlanFeatures()", () => {
  describe("given a contract that withholds webhook endpoints", () => {
    /** @scenario A capability the contract withholds is not advertised as included */
    it("drops that bullet and keeps every other one", () => {
      const features = buildEnterprisePlanFeatures({
        webhookEndpointsEnabled: false,
      });

      expect(features).not.toContain(WEBHOOK_FEATURE_LABEL);
      expect(features).toEqual(
        ENTERPRISE_PLAN_FEATURES.filter((feature) => feature !== WEBHOOK_FEATURE_LABEL),
      );
    });
  });

  describe("given a contract that grants webhook endpoints", () => {
    it("lists everything the tier offers", () => {
      expect(buildEnterprisePlanFeatures({ webhookEndpointsEnabled: true })).toEqual(
        ENTERPRISE_PLAN_FEATURES,
      );
    });
  });

  describe("given a plan that says nothing about webhook endpoints", () => {
    it("lists everything, since silence is answered by the tier and not by us", () => {
      expect(buildEnterprisePlanFeatures({})).toEqual(ENTERPRISE_PLAN_FEATURES);
    });
  });
});
