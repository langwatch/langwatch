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
});
