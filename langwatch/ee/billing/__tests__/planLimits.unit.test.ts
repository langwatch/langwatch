import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "../planLimits";
import { PlanTypes } from "../planTypes";

describe("PLAN_LIMITS", () => {
  describe("when checking critical plan-specific fields", () => {
    it("sets PRO maxProjects to 9999", () => {
      expect(PLAN_LIMITS[PlanTypes.PRO].maxProjects).toBe(9999);
    });

    it("sets GROWTH evaluationsCredit to 50", () => {
      expect(PLAN_LIMITS[PlanTypes.GROWTH].evaluationsCredit).toBe(50);
    });

    it("sets ENTERPRISE evaluationsCredit to 500", () => {
      expect(PLAN_LIMITS[PlanTypes.ENTERPRISE].evaluationsCredit).toBe(500);
    });

    it("sets ENTERPRISE maxProjects to 9999", () => {
      expect(PLAN_LIMITS[PlanTypes.ENTERPRISE].maxProjects).toBe(9999);
    });

    it("sets FREE maxProjects to 1", () => {
      expect(PLAN_LIMITS[PlanTypes.FREE].maxProjects).toBe(1);
    });
  });
});
