import type { PlanInfo, PricingModel } from "@langwatch/entitlement-contract";
/**
 * @vitest-environment node
 * Spec: specs/licensing/usage-enforcement-plan-resolution.feature.
 */
import { OrganizationNotFoundForTeamError } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  type EntitlementUsagePeers,
  USAGE_UNKNOWN,
  type UsageOrganization,
  type UsageVolumeCounter,
  type ProjectUsageCounts,
  UsageService,
} from "../usage-enforcement.service.ts";

const SAAS_UPGRADE = "upgrade your plan at https://app.langwatch.ai/settings/subscription";

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

class TestOrganizations implements UsageOrganization {
  getOrganizationIdByTeamId(): Promise<string> {
    return Promise.resolve("org-1");
  }
  getProjectIds(): Promise<string[]> {
    return Promise.resolve(["project-1"]);
  }
  getPricingModel(): Promise<{ pricingModel: null }> {
    return Promise.resolve({ pricingModel: null });
  }
}

class TestCounter implements UsageVolumeCounter {
  constructor(private readonly counts: ProjectUsageCounts) {}
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
      class FlakyCounter implements UsageVolumeCounter {
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

function freePlan(maxMessagesPerMonth: number): PlanInfo {
  return {
    ...plan(maxMessagesPerMonth),
    planSource: "free",
    type: "FREE",
    name: "Free",
    free: true,
  };
}

/** Records which project ids each unit's counter was asked about. */
class RecordingCounter implements UsageVolumeCounter {
  readonly asked: string[][] = [];

  constructor(private readonly countPerProject: number) {}

  getCountByProjects(input: { projectIds: string[] }): Promise<ProjectUsageCounts> {
    this.asked.push(input.projectIds);

    return Promise.resolve(
      input.projectIds.map((projectId) => ({ projectId, count: this.countPerProject })),
    );
  }
}

function organizationsOwning(projectIds: string[], pricingModel: PricingModel | null = null) {
  return {
    getOrganizationIdByTeamId: () => Promise.resolve("org-1"),
    getProjectIds: () => Promise.resolve(projectIds),
    getPricingModel: () => Promise.resolve({ pricingModel }),
  } satisfies UsageOrganization;
}

describe("UsageService.checkLimit against the plan's allowance", () => {
  describe("given a free organization past its monthly allowance", () => {
    const refusal = async (isSaas: boolean) =>
      UsageService.create({
        organizations: organizationsOwning(["project-1"]),
        traceCounter: new RecordingCounter(0),
        eventCounter: new RecordingCounter(1_200),
        planResolver: vi.fn().mockResolvedValue(freePlan(1_000)),
        deployment: { isSaas, baseHost: "https://langwatch.example.test" },
      }).checkLimit({ teamId: "team-1" });

    /** @scenario "An organization over its plan's allowance is refused by name" */
    it("refuses, naming the unit, the limit and where to raise it", async () => {
      const result = await refusal(true);

      expect(result).toMatchObject({
        exceeded: true,
        count: 1_200,
        maxMessagesPerMonth: 1_000,
        planName: "Free",
        usageUnit: "events",
      });
      expect(result).toHaveProperty(
        "message",
        `Free limit of 1000 events reached. To increase your limits, ${SAAS_UPGRADE}`,
      );
    });

    it("points a self-hosted install at its own licence page", async () => {
      const result = await refusal(false);

      expect(result).toHaveProperty(
        "message",
        "Free limit of 1000 events reached. To increase your limits, buy a license at https://langwatch.example.test/settings/license",
      );
    });
  });

  describe("given a free organization well inside its monthly allowance", () => {
    /** @scenario "An organization inside its allowance is not refused" */
    it("does not refuse", async () => {
      const service = UsageService.create({
        organizations: organizationsOwning(["project-1"]),
        traceCounter: new RecordingCounter(0),
        eventCounter: new RecordingCounter(10),
        planResolver: vi.fn().mockResolvedValue(freePlan(1_000)),
        deployment: { isSaas: true },
      });

      await expect(service.checkLimit({ teamId: "team-1" })).resolves.toEqual({
        exceeded: false,
      });
    });
  });

  describe("given a paying organization whose plan meters it in traces", () => {
    const meteredInTraces = (perProject: number) => {
      const traces = new RecordingCounter(perProject);
      const events = new RecordingCounter(perProject);
      const service = UsageService.create({
        organizations: organizationsOwning(["project-a", "project-b"], "TIERED"),
        traceCounter: traces,
        eventCounter: events,
        planResolver: vi.fn().mockResolvedValue(plan(50_000)),
        deployment: { isSaas: true },
      });

      return { service, traces, events };
    };

    /** @scenario "A trace-metered organization is counted on each project's own endpoint" */
    it("counts every project in traces and measures the sum against the paid allowance", async () => {
      const { service, traces, events } = meteredInTraces(20_000);

      await expect(service.checkLimit({ teamId: "team-1" })).resolves.toEqual({
        exceeded: false,
      });
      expect(traces.asked).toEqual([["project-a", "project-b"]]);
      expect(events.asked).toEqual([]);

      const past = meteredInTraces(25_000);
      await expect(past.service.checkLimit({ teamId: "team-1" })).resolves.toMatchObject({
        exceeded: true,
        count: 50_000,
        maxMessagesPerMonth: 50_000,
        planName: "Growth",
        usageUnit: "traces",
      });
    });
  });

  describe("given a team that resolves to no organization", () => {
    /** @scenario "A team that resolves to no organization is not metered against nobody's plan" */
    it("refuses to answer and reads no plan and no count", async () => {
      const planResolver = vi.fn().mockResolvedValue(plan(1_000));
      const countTracesByProjects = vi.fn().mockResolvedValue([]);
      const countBillableEventsByProjects = vi.fn().mockResolvedValue([]);
      const service = UsageService.overPeers({
        isSaas: true,
        planResolver,
        peers: {
          traces: { countTracesByProjects },
          billing: createApiFixture<EntitlementUsagePeers["billing"]>({
            countBillableEventsByProjects,
          }),
          organizations: createApiFixture<EntitlementUsagePeers["organizations"]>({
            getOrganizationIdByTeamId: async ({ teamId }) => {
              throw new OrganizationNotFoundForTeamError(teamId);
            },
          }),
          projects: { listIdsByOrganization: async () => [] },
        },
      });

      await expect(service.checkLimit({ teamId: "orphan-team" })).rejects.toMatchObject({
        code: "organization_not_found_for_team",
      });
      expect(planResolver).not.toHaveBeenCalled();
      expect(countTracesByProjects).not.toHaveBeenCalled();
      expect(countBillableEventsByProjects).not.toHaveBeenCalled();
    });
  });
});
