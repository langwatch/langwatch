import { PricingModel } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getUsageDisplay } from "../UsageIndicator";

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
