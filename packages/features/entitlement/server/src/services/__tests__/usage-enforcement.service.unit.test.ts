/**
 * @vitest-environment node
 * @unit
 *
 * Spec: specs/licensing/usage-enforcement-plan-resolution.feature.
 */
import { describe, expect, it, vi } from "vitest";
import type { PlanInfo } from "@langwatch/entitlement-contract";
import {
  UsageOrganizationPort,
  UsageVolumeCounterPort,
  type ProjectUsageCounts,
} from "../../ports/usage-enforcement.ports";
import { UsageService } from "../usage-enforcement.service";

function plan(maxMessagesPerMonth: number): PlanInfo {
  return {
    planSource: "subscription",
    type: "paid",
    name: "Growth",
    free: false,
    maxMembers: 10,
    maxMembersLite: 10,
    maxMessagesPerMonth,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  };
}

class TestOrganizations extends UsageOrganizationPort {
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

class TestCounter extends UsageVolumeCounterPort {
  constructor(private readonly counts: ProjectUsageCounts) {
    super();
  }
  getCountByProjects(): Promise<ProjectUsageCounts> {
    return Promise.resolve(this.counts);
  }
}

describe("UsageService.checkLimit", () => {
  describe("given a later active plan lookup would allow more usage", () => {
    /** @scenario "Limit checks decide from one active plan snapshot" */
    it("decides from the plan snapshot the check already resolved", async () => {
      const planResolver = vi.fn().mockResolvedValueOnce(plan(1000)).mockResolvedValue(plan(2000));
      const service = UsageService.create({
        organizations: new TestOrganizations(),
        traceCounter: new TestCounter([{ projectId: "project-1", count: 1000 }]),
        eventCounter: new TestCounter([{ projectId: "project-1", count: 1000 }]),
        planResolver,
        deployment: { isSaas: true },
      });

      const result = await service.checkLimit({ teamId: "team-123" });

      expect(result).toMatchObject({ exceeded: true, maxMessagesPerMonth: 1000 });
      expect(planResolver).toHaveBeenCalledTimes(1);
    });
  });
});
