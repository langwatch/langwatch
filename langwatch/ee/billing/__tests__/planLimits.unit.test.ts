import { describe, expect, it } from "vitest";
import { GROWTH_SEAT_INCLUDED_EVENTS, PLAN_LIMITS, UNLIMITED_MESSAGES } from "../planLimits";
import { PlanTypes } from "../planTypes";
import { GROWTH_SEAT_PLAN_TYPES } from "../utils/growthSeatEvent";

describe("PLAN_LIMITS", () => {
  describe("when checking critical plan-specific fields", () => {
    it("sets PRO maxProjects to 9999", () => {
      expect(PLAN_LIMITS[PlanTypes.PRO].maxProjects).toBe(9999);
    });

    it("sets ENTERPRISE maxProjects to 9999", () => {
      expect(PLAN_LIMITS[PlanTypes.ENTERPRISE].maxProjects).toBe(9999);
    });

    it("sets FREE maxProjects to 2", () => {
      expect(PLAN_LIMITS[PlanTypes.FREE].maxProjects).toBe(2);
    });
  });

  describe("when checking GROWTH_SEAT plan limits", () => {
    it("defines GROWTH_SEAT_INCLUDED_EVENTS as 200_000", () => {
      expect(GROWTH_SEAT_INCLUDED_EVENTS).toBe(200_000);
    });

    it("keeps maxMessagesPerMonth as UNLIMITED for all GROWTH_SEAT plans", () => {
      for (const type of GROWTH_SEAT_PLAN_TYPES) {
        expect(PLAN_LIMITS[type].maxMessagesPerMonth).toBe(UNLIMITED_MESSAGES);
      }
    });
  });
});
