/**
 * @vitest-environment node
 * Enforcement asks the month's volume of every ingested batch. Within the
 * cache's lifetime the answer is the one already taken, so the rollup runs
 * once rather than per batch.
 * @see specs/licensing/enforcement-messages.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { PlanInfo } from "@langwatch/entitlement-contract";
import { InProcessUsageCache } from "../usage-cache.service.ts";
import { UsageOrganization } from "../../app/entitlement.infrastructure.ts";
import {
  UsageVolumeCounter,
  type ProjectUsageCounts,
} from "../../app/entitlement.infrastructure.ts";
import { UsageService } from "../usage-enforcement.service.ts";

const PLAN: PlanInfo = {
  planSource: "subscription",
  type: "paid",
  name: "Growth",
  free: false,
  maxMembers: 10,
  maxMembersLite: 10,
  maxMessagesPerMonth: 10_000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
};

class TestOrganizations implements UsageOrganization {
  tryGetOrganizationIdByTeamId(): Promise<string | null> {
    return Promise.resolve("org-1");
  }
  getProjectIds(): Promise<string[]> {
    return Promise.resolve(["project-1"]);
  }
  tryGetPricingModel(): Promise<null> {
    return Promise.resolve(null);
  }
}

class CountingCounter implements UsageVolumeCounter {
  readonly getCountByProjects = vi.fn(async (): Promise<ProjectUsageCounts> => [
    { projectId: "project-1", count: 5_000 },
  ]);
}

function serviceWithCache(now: () => number) {
  const traceCounter = new CountingCounter();
  const service = UsageService.create({
    organizations: new TestOrganizations(),
    traceCounter,
    eventCounter: new CountingCounter(),
    planResolver: async () => PLAN,
    deployment: { isSaas: true },
    countCache: new InProcessUsageCache(5 * 60 * 1000, now),
    decisionCache: new InProcessUsageCache(5 * 60 * 1000, now),
  });
  return { service, traceCounter };
}

describe("the month's usage count", () => {
  describe("given the count was taken two minutes ago", () => {
    /** @scenario "Uses cached count within TTL" */
    it("answers from the cache without running the rollup again", async () => {
      let clock = 1_000_000;
      const { service, traceCounter } = serviceWithCache(() => clock);

      const first = await service.checkLimit({ teamId: "team-456" });
      clock += 2 * 60 * 1000;
      const second = await service.checkLimit({ teamId: "team-456" });

      expect(first).toEqual({ exceeded: false });
      expect(second).toEqual({ exceeded: false });
      expect(traceCounter.getCountByProjects).toHaveBeenCalledTimes(1);
    });
  });
});
