import { PricingModel } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getUsageDisplay } from "../UsageIndicator";

describe("getUsageDisplay()", () => {
  describe("given self-hosted (isSaaS = false)", () => {
    /** @scenario "Self-hosted deployment always shows the usage bar" */
    it("returns visible with the provided usage unit", () => {
      const result = getUsageDisplay({
        isSaaS: false,
        pricingModel: undefined,
        isFree: false,
        usageUnit: "traces",
      });

      expect(result).toEqual({ visible: true, unitLabel: "traces" });
    });

    /** @scenario "The unit label is whatever the usage API reports, not what the plan implies" */
    it("returns visible with events usage unit", () => {
      const result = getUsageDisplay({
        isSaaS: false,
        pricingModel: undefined,
        isFree: true,
        usageUnit: "events",
      });

      expect(result).toEqual({ visible: true, unitLabel: "events" });
    });
  });

  describe("given SaaS (isSaaS = true)", () => {
    describe("given TIERED pricing model", () => {
      describe("when plan is free", () => {
        /** @scenario "SaaS on the tiered pricing model shows the usage bar on a free plan" */
        it("returns visible with the provided usage unit", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: PricingModel.TIERED,
            isFree: true,
            usageUnit: "events",
          });

          expect(result).toEqual({ visible: true, unitLabel: "events" });
        });
      });

      describe("when plan is paid", () => {
        /** @scenario "SaaS on the tiered pricing model shows the usage bar on a paid plan" */
        it("returns visible with the provided usage unit", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: PricingModel.TIERED,
            isFree: false,
            usageUnit: "traces",
          });

          expect(result).toEqual({ visible: true, unitLabel: "traces" });
        });
      });
    });

    describe("given SEAT_EVENT pricing model", () => {
      describe("when plan is free", () => {
        /** @scenario "SaaS on the seat and event pricing model shows the usage bar on a free plan" */
        it("returns visible with the provided usage unit", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: PricingModel.SEAT_EVENT,
            isFree: true,
            usageUnit: "events",
          });

          expect(result).toEqual({ visible: true, unitLabel: "events" });
        });
      });

      describe("when plan is paid", () => {
        /** @scenario "SaaS on the seat and event pricing model hides the usage bar on a paid plan" */
        it("returns not visible", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: PricingModel.SEAT_EVENT,
            isFree: false,
            usageUnit: "events",
          });

          expect(result).toEqual({ visible: false });
        });
      });
    });

    describe("given no pricing model", () => {
      describe("when pricingModel is undefined", () => {
        /** @scenario "An organization with no pricing model still sees its usage bar" */
        it("returns visible with the provided usage unit", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: undefined,
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
            pricingModel: null,
            isFree: false,
            usageUnit: "events",
          });

          expect(result).toEqual({ visible: true, unitLabel: "events" });
        });
      });
    });
  });
});
