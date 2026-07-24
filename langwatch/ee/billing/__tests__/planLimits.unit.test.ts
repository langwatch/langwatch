import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, UNLIMITED_MESSAGES } from "../planLimits";
import { PlanTypes } from "../planTypes";

describe("PLAN_LIMITS", () => {
  describe("when checking critical plan-specific fields", () => {
    it("sets PRO maxProjects to 9999", () => {
      expect(PLAN_LIMITS[PlanTypes.PRO].maxProjects).toBe(9999);
    });

    it("sets ENTERPRISE maxProjects to 9999", () => {
      expect(PLAN_LIMITS[PlanTypes.ENTERPRISE].maxProjects).toBe(9999);
    });

    // Guards ingestion (checkLimit short-circuits) and the sidebar usage bar
    // (hidden when the plan has no cap). A per-subscription DB override is the
    // only way to re-cap an Enterprise org.
    it("sets ENTERPRISE maxMessagesPerMonth to the unlimited sentinel", () => {
      expect(PLAN_LIMITS[PlanTypes.ENTERPRISE].maxMessagesPerMonth).toBe(
        UNLIMITED_MESSAGES,
      );
    });

    it("sets FREE maxProjects to 2", () => {
      expect(PLAN_LIMITS[PlanTypes.FREE].maxProjects).toBe(2);
    });
  });
});
