/**
 * The staff investigation read of an organization's limits (ADR-202, ops functions): the plan's
 * code and each limit with its count, from the same reading the usage page shows.
 * @see dev/docs/adr/202-ops-agent-access.md
 */
import type { Plan } from "@langwatch/entitlement-contract";
import { UNLIMITED_MESSAGES } from "@langwatch/plans";
import { describe, expect, it } from "vitest";

import { MemoryEntitlementDatabase } from "../../repositories/memory/memory.entitlement.database.ts";
import { MemoryMemberSeatRepository } from "../../repositories/memory/memory.member-seat.repository.ts";
import { USAGE_UNKNOWN } from "../../services/usage-enforcement.service.ts";
import { createEntitlementTestApp, TestUsageCounter } from "./entitlement.fixture.ts";

const ORGANIZATION_ID = "organization-1";

const free: Plan = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  maxMembers: 2,
  maxMembersLite: 5,
  maxMembersDeveloper: 0,
  maxMessagesPerMonth: 1_000,
  maxScenarios: 3,
  maxScenarioSets: 3,
  maxEvaluators: 3,
  canPublish: false,
  prices: { USD: 0, EUR: 0 },
};

const enterprise: Plan = {
  ...free,
  planSource: "license",
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  maxMembers: Number.MAX_SAFE_INTEGER,
  maxMessagesPerMonth: UNLIMITED_MESSAGES,
  maxScenarios: undefined,
  maxScenarioSets: undefined,
  maxEvaluators: undefined,
};

function appOn({ plan, counter }: { plan: Plan; counter: TestUsageCounter }) {
  const memory = MemoryEntitlementDatabase.create();
  memory.put({
    organizationId: ORGANIZATION_ID,
    memberCount: 2,
    membersLiteCount: 1,
    developerCount: 0,
    currentMonthCost: 12.5,
    projectCosts: {},
    spendByUserId: {},
  });
  return createEntitlementTestApp({
    repositories: { seats: MemoryMemberSeatRepository.create({ memory }) },
    infrastructure: { baseline: plan, counter },
  });
}

describe("EntitlementModule.getUsageLimits", () => {
  describe("given an organization on Free with two members and 400 traces this month", () => {
    it("answers the plan code, each cap and its count", async () => {
      const app = appOn({ plan: free, counter: TestUsageCounter.create(400, "traces") });

      await expect(app.getUsageLimits({ organizationId: ORGANIZATION_ID })).resolves.toEqual({
        plan: "FREE",
        limits: [
          { name: "traces_per_month", cap: 1_000, used: 400 },
          { name: "members", cap: 2, used: 2 },
          { name: "members_lite", cap: 5, used: 1 },
          { name: "members_developer", cap: 0, used: 0 },
          { name: "scenarios", cap: 3, used: null },
          { name: "scenario_suites", cap: 3, used: null },
          { name: "evaluators", cap: 3, used: null },
        ],
      });
    });

    it("carries no display name and no price", async () => {
      const app = appOn({ plan: free, counter: TestUsageCounter.create(400, "traces") });

      const text = JSON.stringify(await app.getUsageLimits({ organizationId: ORGANIZATION_ID }));

      expect(text).not.toContain("Free");
      expect(text).not.toContain("12.5");
    });
  });

  describe("given an uncapped plan metered in events", () => {
    it("answers null caps where the plan sets none", async () => {
      const app = appOn({ plan: enterprise, counter: TestUsageCounter.create(42, "events") });

      const { plan, limits } = await app.getUsageLimits({ organizationId: ORGANIZATION_ID });

      expect(plan).toBe("ENTERPRISE");
      expect(limits).toContainEqual({ name: "events_per_month", cap: null, used: 42 });
      expect(limits).toContainEqual({ name: "members", cap: null, used: 2 });
      expect(limits.map(({ name }) => name)).not.toContain("scenarios");
    });
  });

  describe("when the counting store cannot answer", () => {
    it("answers the month's count as null, never zero", async () => {
      const app = appOn({ plan: free, counter: TestUsageCounter.create(USAGE_UNKNOWN, "traces") });

      const { limits } = await app.getUsageLimits({ organizationId: ORGANIZATION_ID });

      expect(limits[0]).toEqual({ name: "traces_per_month", cap: 1_000, used: null });
    });
  });
});
