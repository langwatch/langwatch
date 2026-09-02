import { describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/enterprise-billing-contract", async (importOriginal) => ({
  ...(await importOriginal()),
  isGrowthSeatEventPlan: (planType: string) => planType.startsWith("GROWTH_SEAT_"),
}));

import { resolveCurrentComparisonPlan } from "../plan-current-resolver";

describe("resolveCurrentComparisonPlan()", () => {
  describe("when activePlan is undefined", () => {
    it("returns null", () => {
      expect(resolveCurrentComparisonPlan(undefined)).toBeNull();
    });
  });

  describe("when activePlan has no type and free is not set", () => {
    it("returns null", () => {
      expect(resolveCurrentComparisonPlan({})).toBeNull();
    });
  });

  describe("when activePlan is a free plan", () => {
    it('returns "free" when free flag is true', () => {
      expect(resolveCurrentComparisonPlan({ free: true })).toBe("free");
    });

    it('returns "free" when type is "FREE"', () => {
      expect(resolveCurrentComparisonPlan({ type: "FREE" })).toBe("free");
    });

    it('returns "free" when type is lowercase "free"', () => {
      expect(resolveCurrentComparisonPlan({ type: "free" })).toBe("free");
    });

    it('returns "free" when free flag is true regardless of type', () => {
      expect(resolveCurrentComparisonPlan({ type: "SOMETHING", free: true })).toBe(
        "free",
      );
    });
  });

  describe("when activePlan is a growth plan", () => {
    it('returns "growth" when type is "GROWTH"', () => {
      expect(resolveCurrentComparisonPlan({ type: "GROWTH" })).toBe("growth");
    });

    it('returns "growth" when type is lowercase "growth"', () => {
      expect(resolveCurrentComparisonPlan({ type: "growth" })).toBe("growth");
    });

    it('returns "growth" for GROWTH_SEAT_EUR_MONTHLY variant', () => {
      expect(resolveCurrentComparisonPlan({ type: "GROWTH_SEAT_EUR_MONTHLY" })).toBe(
        "growth",
      );
    });

    it('returns "growth" for GROWTH_SEAT_EUR_ANNUAL variant', () => {
      expect(resolveCurrentComparisonPlan({ type: "GROWTH_SEAT_EUR_ANNUAL" })).toBe(
        "growth",
      );
    });

    it('returns "growth" for GROWTH_SEAT_USD_MONTHLY variant', () => {
      expect(resolveCurrentComparisonPlan({ type: "GROWTH_SEAT_USD_MONTHLY" })).toBe(
        "growth",
      );
    });

    it('returns "growth" for GROWTH_SEAT_USD_ANNUAL variant', () => {
      expect(resolveCurrentComparisonPlan({ type: "GROWTH_SEAT_USD_ANNUAL" })).toBe(
        "growth",
      );
    });
  });

  describe("when activePlan is an enterprise plan", () => {
    /** @scenario A licensed deployment is still shown the tier its license names */
    it('returns "enterprise" when type is "ENTERPRISE"', () => {
      expect(resolveCurrentComparisonPlan({ type: "ENTERPRISE" })).toBe("enterprise");
    });

    it('returns "enterprise" when type is lowercase "enterprise"', () => {
      expect(resolveCurrentComparisonPlan({ type: "enterprise" })).toBe("enterprise");
    });
  });

  describe("when the deployment is self-hosted without a license", () => {
    /** @scenario An unlicensed deployment is not shown the Cloud free tier as its plan */
    it("marks no Cloud tier as current, despite the plan being flagged free", () => {
      // The open-source baseline is flagged `free` but is not the Cloud Free
      // tier and is not capped like one. Marking that column current would
      // present its two-seat, fifty-thousand-event numbers as the deployment's.
      expect(
        resolveCurrentComparisonPlan({ type: "OPEN_SOURCE", free: true }),
      ).toBeNull();
    });

    it("is not fooled by casing", () => {
      expect(
        resolveCurrentComparisonPlan({ type: "open_source", free: true }),
      ).toBeNull();
    });
  });

  describe("when activePlan has an unrecognized type", () => {
    it("returns null for unknown plan type", () => {
      expect(resolveCurrentComparisonPlan({ type: "PRO" })).toBeNull();
    });

    it("returns null for another unknown plan type", () => {
      expect(resolveCurrentComparisonPlan({ type: "LAUNCH" })).toBeNull();
    });
  });

  describe("when activePlan has null fields", () => {
    it("returns null when type is null and free is null", () => {
      expect(resolveCurrentComparisonPlan({ type: null, free: null })).toBeNull();
    });

    it("returns null when type is null and free is false", () => {
      expect(resolveCurrentComparisonPlan({ type: null, free: false })).toBeNull();
    });
  });
});
