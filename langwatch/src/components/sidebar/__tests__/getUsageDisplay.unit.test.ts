import { describe, expect, it } from "vitest";
import { getUsageDisplay } from "../UsageIndicator";

describe("getUsageDisplay()", () => {
  describe("given self-hosted (isSaaS = false)", () => {
    it("returns visible with the provided usage unit", () => {
      const result = getUsageDisplay({
        isSaaS: false,
        billing: undefined,
        isFree: false,
        usageUnit: "traces",
      });

      expect(result).toEqual({ visible: true, unitLabel: "traces" });
    });

    it("returns visible with events usage unit", () => {
      const result = getUsageDisplay({
        isSaaS: false,
        billing: undefined,
        isFree: true,
        usageUnit: "events",
      });

      expect(result).toEqual({ visible: true, unitLabel: "events" });
    });
  });

  describe("given SaaS (isSaaS = true)", () => {
    describe("given TIERED pricing model", () => {
      describe("when plan is free", () => {
        it("returns visible with the provided usage unit", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            billing: { showUsageLimits: true },
            isFree: true,
            usageUnit: "events",
          });

          expect(result).toEqual({ visible: true, unitLabel: "events" });
        });
      });

      describe("when plan is paid", () => {
        it("returns visible with the provided usage unit", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            billing: { showUsageLimits: true },
            isFree: false,
            usageUnit: "traces",
          });

          expect(result).toEqual({ visible: true, unitLabel: "traces" });
        });
      });
    });

    describe("given SEAT_EVENT pricing model", () => {
      describe("when plan is free", () => {
        it("returns visible with the provided usage unit", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            billing: { showUsageLimits: false },
            isFree: true,
            usageUnit: "events",
          });

          expect(result).toEqual({ visible: true, unitLabel: "events" });
        });
      });

      describe("when plan is paid", () => {
        it("returns not visible", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            billing: { showUsageLimits: false },
            isFree: false,
            usageUnit: "events",
          });

          expect(result).toEqual({ visible: false });
        });
      });
    });

    describe("given no pricing model", () => {
      describe("when pricingModel is undefined", () => {
        it("returns visible with the provided usage unit", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            billing: undefined,
            isFree: false,
            usageUnit: "traces",
          });

          expect(result).toEqual({ visible: true, unitLabel: "traces" });
        });
      });

      describe("when pricingModel is null", () => {
        it("returns visible with the provided usage unit", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            billing: undefined,
            isFree: false,
            usageUnit: "events",
          });

          expect(result).toEqual({ visible: true, unitLabel: "events" });
        });
      });
    });
  });
});
