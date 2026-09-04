import { describe, expect, it } from "vitest";
import { getUsageDisplay } from "../usage-indicator";

/**
 * Spec: specs/usage-indicator-display.feature
 *
 * `pricingModel` arrives as the wire's own string (this package may not
 * import the Prisma `PricingModel` enum), so the two values that matter to
 * `getUsageDisplay` are named here literally: `"TIERED"` and `"SEAT_EVENT"`.
 */
describe("getUsageDisplay()", () => {
  describe("given the deployment is self-hosted", () => {
    /** @scenario Self-hosted deployment always shows usage bar with "traces" label */
    it("shows the usage bar with the traces label", () => {
      const result = getUsageDisplay({
        isSaaS: false,
        pricingModel: undefined,
        isFree: false,
        usageUnit: "traces",
      });

      expect(result).toEqual({ visible: true, unitLabel: "traces" });
    });
  });

  describe("given the deployment is SaaS", () => {
    describe("given the organization uses the TIERED pricing model", () => {
      describe("when the active plan is FREE", () => {
        /** @scenario SaaS TIERED free plan shows usage bar with "traces" label */
        it("shows the usage bar with the traces label", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: "TIERED",
            isFree: true,
            usageUnit: "traces",
          });

          expect(result).toEqual({ visible: true, unitLabel: "traces" });
        });
      });

      describe("when the active plan is a paid plan", () => {
        /** @scenario SaaS TIERED paid plan shows usage bar with "traces" label */
        it("shows the usage bar with the traces label", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: "TIERED",
            isFree: false,
            usageUnit: "traces",
          });

          expect(result).toEqual({ visible: true, unitLabel: "traces" });
        });
      });
    });

    describe("given the organization uses the SEAT_EVENT pricing model", () => {
      describe("when the active plan is FREE", () => {
        /** @scenario SaaS SEAT_EVENT free plan shows usage bar with "events" label */
        it("shows the usage bar with the events label", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: "SEAT_EVENT",
            isFree: true,
            usageUnit: "events",
          });

          expect(result).toEqual({ visible: true, unitLabel: "events" });
        });
      });

      describe("when the active plan is a paid plan", () => {
        /** @scenario SaaS SEAT_EVENT paid plan hides the usage bar */
        it("hides the usage bar", () => {
          const result = getUsageDisplay({
            isSaaS: true,
            pricingModel: "SEAT_EVENT",
            isFree: false,
            usageUnit: "events",
          });

          expect(result).toEqual({ visible: false });
        });
      });
    });

    describe("given no pricing model on the organization", () => {
      it("shows the usage bar with the provided usage unit", () => {
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
