import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../ee/billing/utils/growthSeatEvent", () => ({
  isGrowthSeatEventPlan: (planType: string) =>
    planType.startsWith("GROWTH_SEAT_"),
}));

import { resolveCurrentComparisonPlan } from "../planCurrentResolver";

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
      expect(
        resolveCurrentComparisonPlan({ type: "SOMETHING", free: true }),
      ).toBe("free");
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
      expect(
        resolveCurrentComparisonPlan({ type: "GROWTH_SEAT_EUR_MONTHLY" }),
      ).toBe("growth");
    });

    it('returns "growth" for GROWTH_SEAT_EUR_ANNUAL variant', () => {
      expect(
        resolveCurrentComparisonPlan({ type: "GROWTH_SEAT_EUR_ANNUAL" }),
      ).toBe("growth");
    });

    it('returns "growth" for GROWTH_SEAT_USD_MONTHLY variant', () => {
      expect(
        resolveCurrentComparisonPlan({ type: "GROWTH_SEAT_USD_MONTHLY" }),
      ).toBe("growth");
    });

    it('returns "growth" for GROWTH_SEAT_USD_ANNUAL variant', () => {
      expect(
        resolveCurrentComparisonPlan({ type: "GROWTH_SEAT_USD_ANNUAL" }),
      ).toBe("growth");
    });
  });

  describe("when activePlan is an enterprise plan", () => {
    it('returns "enterprise" when type is "ENTERPRISE"', () => {
      expect(resolveCurrentComparisonPlan({ type: "ENTERPRISE" })).toBe(
        "enterprise",
      );
    });

    it('returns "enterprise" when type is lowercase "enterprise"', () => {
      expect(resolveCurrentComparisonPlan({ type: "enterprise" })).toBe(
        "enterprise",
      );
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
      expect(
        resolveCurrentComparisonPlan({ type: null, free: null }),
      ).toBeNull();
    });

    it("returns null when type is null and free is false", () => {
      expect(
        resolveCurrentComparisonPlan({ type: null, free: false }),
      ).toBeNull();
    });
  });
});
