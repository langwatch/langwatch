/**
 * @vitest-environment node
 * Spec: specs/licensing/usage-enforcement-plan-resolution.feature.
 */
import { describe, expect, it, vi } from "vitest";
import type { PlanInfo } from "@langwatch/entitlement-contract";
import { USAGE_UNKNOWN } from "../../ports/usage-counter.port";
import { UsageOrganizationPort } from "../../ports/usage-organization.port";
import {
  UsageVolumeCounterPort,
  type ProjectUsageCounts,
} from "../../ports/usage-volume-counter.port";
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

describe("given the counting store could not answer", () => {
  const serviceSeeingUnknown = () =>
    UsageService.create({
      organizations: new TestOrganizations(),
      traceCounter: new TestCounter(USAGE_UNKNOWN),
      eventCounter: new TestCounter(USAGE_UNKNOWN),
      planResolver: vi.fn().mockResolvedValue(plan(1000)),
      deployment: { isSaas: true },
    });

  describe("when a limit is checked", () => {
    /**
     * The permissive outcome is deliberate: an outage in OUR counting store
     * must not lock a paying customer out of their own product. What this pins
     * is WHERE that decision is made — the count stays unknown all the way to
     * enforcement, rather than a counting service returning a zero that reads
     * as "no usage" by accident and is invisible in the logs.
     */
    /** @scenario Usage limits are not enforced against a count we could not take */
    it("allows traffic rather than enforcing against a fabricated zero", async () => {
      await expect(serviceSeeingUnknown().checkLimit({ teamId: "team-123" })).resolves.toEqual({
        exceeded: false,
      });
    });

    /** @scenario An unknown count is never cached */
    it("enforces again as soon as the store answers, rather than serving a cached unknown", async () => {
      const counts: ProjectUsageCounts[] = [
        USAGE_UNKNOWN,
        [{ projectId: "project-1", count: 90_000 }],
      ];
      class FlakyCounter extends UsageVolumeCounterPort {
        getCountByProjects(): Promise<ProjectUsageCounts> {
          return Promise.resolve(counts.shift() ?? USAGE_UNKNOWN);
        }
      }
      const service = UsageService.create({
        organizations: new TestOrganizations(),
        traceCounter: new FlakyCounter(),
        eventCounter: new FlakyCounter(),
        planResolver: vi.fn().mockResolvedValue(plan(1000)),
        deployment: { isSaas: true },
      });

      await expect(service.checkLimit({ teamId: "team-123" })).resolves.toEqual({
        exceeded: false,
      });
      await expect(service.checkLimit({ teamId: "team-123" })).resolves.toMatchObject({
        exceeded: true,
      });
    });
  });

  describe("when the per-project breakdown is read", () => {
    /** @scenario A partial per-project breakdown is reported as unknown, not as zeros */
    it("reports unknown rather than a breakdown of zeros", async () => {
      await expect(
        serviceSeeingUnknown().getCountByProjects({
          organizationId: "org-1",
          projectIds: ["project-1"],
        }),
      ).resolves.toBe(USAGE_UNKNOWN);
    });
  });
});
