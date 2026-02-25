import { PricingModel } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getUsageDisplay, shouldShowPlanLimits } from "../UsageIndicator";

describe("getUsageDisplay()", () => {
  describe("given self-hosted (isSaaS = false)", () => {
    it("returns visible with 'traces' unit label", () => {
      const result = getUsageDisplay({
        isSaaS: false,
        pricingModel: undefined,
        isFree: false,
      });

      expect(result).toEqual({ visible: true, unitLabel: "traces" });
    });

    it("returns visible regardless of pricing model or plan", () => {
      const result = getUsageDisplay({
        isSaaS: false,
        pricingModel: PricingModel.SEAT_EVENT,
        isFree: false,
      });

      expect(result).toEqual({ visible: true, unitLabel: "traces" });
    });
  });

  describe("given SaaS (isSaaS = true)", () => {
    describe("given TIERED pricing model", () => {
      describe("when plan is free", () => {
        it("returns visible with 'traces' unit label", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: PricingModel.TIERED,
            isFree: true,
          });

          expect(result).toEqual({ visible: true, unitLabel: "traces" });
        });
      });

      describe("when plan is paid", () => {
        it("returns visible with 'traces' unit label", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: PricingModel.TIERED,
            isFree: false,
          });

          expect(result).toEqual({ visible: true, unitLabel: "traces" });
        });
      });
    });

    describe("given SEAT_EVENT pricing model", () => {
      describe("when plan is free", () => {
        it("returns visible with 'events' unit label", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: PricingModel.SEAT_EVENT,
            isFree: true,
          });

          expect(result).toEqual({ visible: true, unitLabel: "events" });
        });
      });

      describe("when plan is paid", () => {
        it("returns not visible", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: PricingModel.SEAT_EVENT,
            isFree: false,
          });

          expect(result).toEqual({ visible: false });
        });
      });
    });

    describe("given no pricing model", () => {
      describe("when pricingModel is undefined", () => {
        it("returns visible with 'traces' unit label", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: undefined,
            isFree: false,
          });

          expect(result).toEqual({ visible: true, unitLabel: "traces" });
        });
      });

      describe("when pricingModel is null", () => {
        it("returns visible with 'traces' unit label", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: null,
            isFree: false,
          });

          expect(result).toEqual({ visible: true, unitLabel: "traces" });
        });
      });
    });
  });
});

describe("shouldShowPlanLimits()", () => {
  describe("given a free plan", () => {
    it("returns true regardless of pricing model", () => {
      expect(
        shouldShowPlanLimits({
          isFree: true,
          isEnterprise: false,
          pricingModel: PricingModel.SEAT_EVENT,
        })
      ).toBe(true);

      expect(
        shouldShowPlanLimits({
          isFree: true,
          isEnterprise: false,
          pricingModel: PricingModel.TIERED,
        })
      ).toBe(true);
    });
  });

  describe("given a paid non-enterprise plan", () => {
    describe("when pricing model is TIERED", () => {
      it("returns true", () => {
        expect(
          shouldShowPlanLimits({
            isFree: false,
            isEnterprise: false,
            pricingModel: PricingModel.TIERED,
          })
        ).toBe(true);
      });
    });

    describe("when pricing model is SEAT_EVENT", () => {
      it("returns false", () => {
        expect(
          shouldShowPlanLimits({
            isFree: false,
            isEnterprise: false,
            pricingModel: PricingModel.SEAT_EVENT,
          })
        ).toBe(false);
      });
    });
  });

  describe("given an enterprise plan", () => {
    it("returns false regardless of pricing model", () => {
      expect(
        shouldShowPlanLimits({
          isFree: false,
          isEnterprise: true,
          pricingModel: PricingModel.TIERED,
        })
      ).toBe(false);

      expect(
        shouldShowPlanLimits({
          isFree: false,
          isEnterprise: true,
          pricingModel: PricingModel.SEAT_EVENT,
        })
      ).toBe(false);
    });
  });
});
