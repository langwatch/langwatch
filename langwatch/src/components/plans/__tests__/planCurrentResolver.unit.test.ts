import { describe, expect, it } from "vitest";
import { resolveCurrentComparisonPlan } from "../planCurrentResolver";

describe("resolveCurrentComparisonPlan()", () => {
  describe("when plan type is mapped to a comparison column", () => {
    it("returns free for FREE plan", () => {
      expect(
        resolveCurrentComparisonPlan({
          type: "FREE",
          free: true,
        }),
      ).toBe("free");
    });

    it("returns growth for GROWTH_SEAT_EVENT plan", () => {
      expect(
        resolveCurrentComparisonPlan({
          type: "GROWTH_SEAT_EVENT",
          free: false,
        }),
      ).toBe("growth");
    });

    it("returns growth for GROWTH plan", () => {
      expect(
        resolveCurrentComparisonPlan({
          type: "GROWTH",
          free: false,
        }),
      ).toBe("growth");
    });

    it("returns enterprise for ENTERPRISE plan", () => {
      expect(
        resolveCurrentComparisonPlan({
          type: "ENTERPRISE",
          free: false,
        }),
      ).toBe("enterprise");
    });
  });

  describe("when plan type is legacy or unsupported", () => {
    it("returns null for LAUNCH plan", () => {
      expect(
        resolveCurrentComparisonPlan({
          type: "LAUNCH",
          free: false,
        }),
      ).toBeNull();
    });

    it("returns null for ACCELERATE plan", () => {
      expect(
        resolveCurrentComparisonPlan({
          type: "ACCELERATE",
          free: false,
        }),
      ).toBeNull();
    });
  });

  describe("when plan data is missing", () => {
    it("returns null", () => {
      expect(resolveCurrentComparisonPlan(undefined)).toBeNull();
    });
  });
});
