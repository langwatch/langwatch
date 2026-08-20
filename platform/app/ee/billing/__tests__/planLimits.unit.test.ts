import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "../planLimits";
import { PlanTypes } from "../planTypes";

describe("PLAN_LIMITS", () => {
  describe("when checking critical plan-specific fields", () => {
    it("sets PRO maxMembers to 5", () => {
      expect(PLAN_LIMITS[PlanTypes.PRO].maxMembers).toBe(5);
    });

    it("sets ENTERPRISE maxMembers to 1000", () => {
      expect(PLAN_LIMITS[PlanTypes.ENTERPRISE].maxMembers).toBe(1000);
    });

    it("sets FREE maxMembers to 2", () => {
      expect(PLAN_LIMITS[PlanTypes.FREE].maxMembers).toBe(2);
    });
  });

  describe("when checking the webhook endpoints entitlement", () => {
    /** @scenario An enterprise subscription with no license is entitled */
    it("states it on ENTERPRISE rather than leaving it to be inferred", () => {
      expect(PLAN_LIMITS[PlanTypes.ENTERPRISE].webhookEndpointsEnabled).toBe(
        true,
      );
    });

    /** @scenario A plan below enterprise is not entitled */
    it("does not grant it to the plans sold below enterprise", () => {
      expect(
        PLAN_LIMITS[PlanTypes.GROWTH].webhookEndpointsEnabled,
      ).toBeUndefined();
      expect(
        PLAN_LIMITS[PlanTypes.FREE].webhookEndpointsEnabled,
      ).toBeUndefined();
      expect(
        PLAN_LIMITS[PlanTypes.PRO].webhookEndpointsEnabled,
      ).toBeUndefined();
    });
  });
});
