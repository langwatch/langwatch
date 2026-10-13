import { describe, expect, it } from "vitest";

import { buildSeatLimitInfo } from "../seat-limit.rules.ts";

/** The cloud Free plan's seats: 2 members, no Lite Members. */
const FREE_PLAN = {
  planSource: "free" as const,
  maxMembers: 2,
  maxMembersLite: 0,
  overrideAddingLimitations: false,
};

describe("buildSeatLimitInfo()", () => {
  describe("when a Free organization uses more member seats than the plan includes", () => {
    /** @scenario "Seat usage above the plan's member limit is reported as exceeded" */
    it("reports the seat limit as exceeded with the counts", () => {
      const info = buildSeatLimitInfo({ plan: FREE_PLAN, membersCount: 3, membersLiteCount: 0 });

      expect(info.status).toBe("exceeded");
      expect(info.members).toEqual({ current: 3, max: 2, exceeded: true });
      expect(info.message).toBe(
        "Your organization uses 3 member seats and your plan includes 2 member seats.",
      );
    });
  });

  describe("when a Free organization has Lite Members the plan does not include", () => {
    /** @scenario "Seat usage above the plan's Lite Member limit is reported as exceeded" */
    it("reports the seat limit as exceeded", () => {
      const info = buildSeatLimitInfo({ plan: FREE_PLAN, membersCount: 1, membersLiteCount: 2 });

      expect(info.status).toBe("exceeded");
      expect(info.membersLite.exceeded).toBe(true);
      expect(info.members.exceeded).toBe(false);
      expect(info.message).toBe(
        "Your organization uses 2 Lite Member seats and your plan includes no Lite Member seats.",
      );
    });
  });

  describe("when a Free organization is over both member and Lite Member seats", () => {
    it("names both overages in the message", () => {
      const info = buildSeatLimitInfo({ plan: FREE_PLAN, membersCount: 3, membersLiteCount: 1 });

      expect(info.message).toBe(
        "Your organization uses 3 member seats and your plan includes 2 member seats. Your organization uses 1 Lite Member seat and your plan includes no Lite Member seats.",
      );
    });
  });

  describe("when the organization uses exactly the seats the plan includes", () => {
    /** @scenario "Seat usage within the plan's limits is not reported as exceeded" */
    it("reports the seat limit as ok", () => {
      const info = buildSeatLimitInfo({ plan: FREE_PLAN, membersCount: 2, membersLiteCount: 0 });

      expect(info.status).toBe("ok");
      expect(info.message).toBe("");
    });
  });

  describe("when the plan has no member limit", () => {
    /** @scenario "A plan with no member limit never reports the seat limit as exceeded" */
    it("reports the seat limit as ok", () => {
      const info = buildSeatLimitInfo({
        plan: {
          ...FREE_PLAN,
          maxMembers: Number.MAX_SAFE_INTEGER,
          maxMembersLite: Number.MAX_SAFE_INTEGER,
        },
        membersCount: 500,
        membersLiteCount: 500,
      });

      expect(info.status).toBe("ok");
    });
  });

  describe("when the plan's limits are overridden", () => {
    it("reports the seat limit as ok", () => {
      const info = buildSeatLimitInfo({
        plan: { ...FREE_PLAN, overrideAddingLimitations: true },
        membersCount: 3,
        membersLiteCount: 0,
      });

      expect(info.status).toBe("ok");
    });
  });

  describe("when the plan comes from a license", () => {
    /** @scenario "A license plan is left to the license page" */
    it("reports the seat limit as ok", () => {
      const info = buildSeatLimitInfo({
        plan: { ...FREE_PLAN, planSource: "license" },
        membersCount: 5,
        membersLiteCount: 0,
      });

      expect(info.status).toBe("ok");
    });
  });
});
