import type { Plan } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";

import { createEntitlementTestApp, TestUsageCounter } from "./entitlement.fixture.ts";

const free: Plan = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  maxMembers: 5,
  maxMembersLite: 5,
  maxMessagesPerMonth: 1_000,
  canPublish: false,
  prices: { USD: 0, EUR: 0 },
};

describe("EntitlementApp.assertWithinUsageLimit", () => {
  describe("given an organization past its monthly allowance", () => {
    /** @scenario "An organization past its monthly allowance is refused with the plan limit" */
    it("throws the plan limit with the reading it decided from", async () => {
      const app = createEntitlementTestApp({
        members: {
          baseline: free,
          counter: TestUsageCounter.create(1_000).withLimit({
            exceeded: true,
            message: "You reached the limit of 1000 traces for this month",
            count: 1_000,
            maxMessagesPerMonth: 1_000,
            planName: "Free",
            usageUnit: "traces",
          }),
        },
      });

      await expect(
        app.assertWithinUsageLimit({ organizationId: "organization-1" }),
      ).rejects.toMatchObject({
        code: "ERR_PLAN_LIMIT",
        httpStatus: 402,
        meta: {
          currentMonthMessagesCount: 1_000,
          maxMessagesPerMonth: 1_000,
          activePlanName: "Free",
        },
      });
    });
  });

  describe("given an organization within its monthly allowance", () => {
    /** @scenario "An organization within its monthly allowance is let through" */
    it("resolves without refusing", async () => {
      const app = createEntitlementTestApp({
        members: { baseline: free, counter: TestUsageCounter.create(10) },
      });

      await expect(
        app.assertWithinUsageLimit({ organizationId: "organization-1" }),
      ).resolves.toBeUndefined();
    });
  });
});
