import type { PlanInfo, PricingModel } from "@langwatch/entitlement-contract";
/**
 * @vitest-environment node
 * Spec: specs/licensing/usage-enforcement-plan-resolution.feature.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BillableEventsMeterRepository } from "../../repositories/billable-events-meter.repository.ts";
import { MemoryTraceMeterRepository } from "../../repositories/memory/memory.trace-meter.repository.ts";
import { UsageCountingService } from "../usage-counting.service.ts";
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

describe("UsageService.checkLimitForOrganization", () => {
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

      const result = await service.checkLimitForOrganization({ organizationId: "org-1" });

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
      await expect(
        serviceSeeingUnknown().checkLimitForOrganization({ organizationId: "org-1" }),
      ).resolves.toEqual({
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

      await expect(service.checkLimitForOrganization({ organizationId: "org-1" })).resolves.toEqual(
        {
          exceeded: false,
        },
      );
      await expect(
        service.checkLimitForOrganization({ organizationId: "org-1" }),
      ).resolves.toMatchObject({
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
    getProjectIds: () => Promise.resolve(projectIds),
    getPricingModel: () => Promise.resolve({ pricingModel }),
  } satisfies UsageOrganization;
}

describe("UsageService.checkLimitForOrganization against the plan's allowance", () => {
  describe("given a free organization past its monthly allowance", () => {
    const refusal = async (isSaas: boolean) =>
      UsageService.create({
        organizations: organizationsOwning(["project-1"]),
        traceCounter: new RecordingCounter(0),
        eventCounter: new RecordingCounter(1_200),
        planResolver: vi.fn().mockResolvedValue(freePlan(1_000)),
        deployment: { isSaas, baseHost: "https://langwatch.example.test" },
      }).checkLimitForOrganization({ organizationId: "org-1" });

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

      await expect(service.checkLimitForOrganization({ organizationId: "org-1" })).resolves.toEqual(
        {
          exceeded: false,
        },
      );
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

      await expect(service.checkLimitForOrganization({ organizationId: "org-1" })).resolves.toEqual(
        {
          exceeded: false,
        },
      );
      expect(traces.asked).toEqual([["project-a", "project-b"]]);
      expect(events.asked).toEqual([]);

      const past = meteredInTraces(25_000);
      await expect(
        past.service.checkLimitForOrganization({ organizationId: "org-1" }),
      ).resolves.toMatchObject({
        exceeded: true,
        count: 50_000,
        maxMessagesPerMonth: 50_000,
        planName: "Growth",
        usageUnit: "traces",
      });
    });
  });
});

/** An events-metered organization's trace meter: asking it is a defect. */
async function refuseTraceCount(): Promise<never> {
  throw new Error("an events-metered organization's trace meter is never read");
}

/** An organization off Cloud on a free plan, so it is metered in events, over a given meter. */
function eventsServiceOver({
  meter,
  projectIds = ["project-1", "project-2"],
}: {
  meter: Pick<BillableEventsMeterRepository, "countByProjects">;
  projectIds?: string[];
}) {
  return UsageService.overPeers({
    isSaas: false,
    planResolver: async () => ({ ...plan(1_000), free: true }),
    meter,
    traceMeter: { countByProjects: refuseTraceCount },
    peers: {
      billing: createApiFixture<EntitlementUsagePeers["billing"]>({
        getPricingModel: async () => ({ pricingModel: null }),
      }),
    },
    tenancy: {
      findProjectIds: async () => projectIds,
      findMeteredOrganizationIds: async () => ["org-1"],
    },
  });
}

describe("UsageService.overPeers counting events", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given projects with events in entitlement's meter this month", () => {
    /** @scenario "Enforcement counts events from entitlement's own meter" */
    it("counts the meter's events across the projects and asks billing for none", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-02-10T00:00:00Z"));
      const countByProjects = vi.fn<BillableEventsMeterRepository["countByProjects"]>(async () => [
        { projectId: "project-1", count: 600 },
        { projectId: "project-2", count: 500 },
      ]);
      const service = eventsServiceOver({ meter: { countByProjects } });

      await expect(
        service.checkLimitForOrganization({ organizationId: "org-1" }),
      ).resolves.toMatchObject({ exceeded: true, count: 1_100, usageUnit: "events" });
      expect(countByProjects).toHaveBeenCalledWith({
        organizationId: "org-1",
        projectIds: ["project-1", "project-2"],
        window: { startDate: "2026-02-01 00:00:00.000", endDate: "2026-03-01 00:00:00.000" },
      });
    });
  });

  describe("given a second project that sent nothing this month", () => {
    /** @scenario "A project with no metered events this month counts zero" */
    it("reports the first project's events and zero for the second", async () => {
      const service = eventsServiceOver({
        meter: { countByProjects: async () => [{ projectId: "project-1", count: 7 }] },
      });

      await expect(
        service.getCountByProjects({
          organizationId: "org-1",
          projectIds: ["project-1", "project-2"],
        }),
      ).resolves.toEqual([
        { projectId: "project-1", count: 7 },
        { projectId: "project-2", count: 0 },
      ]);
    });
  });

  describe("given an organization that owns no projects", () => {
    /** @scenario "An organization with no projects reads no meter" */
    it("reports no project and never reads the meter", async () => {
      const countByProjects = vi.fn<BillableEventsMeterRepository["countByProjects"]>();
      const service = eventsServiceOver({ meter: { countByProjects }, projectIds: [] });

      await expect(
        service.getCountByProjects({ organizationId: "org-1", projectIds: [] }),
      ).resolves.toEqual([]);
      expect(countByProjects).not.toHaveBeenCalled();
    });
  });

  describe("given a meter that cannot be read", () => {
    /** @scenario "A meter that cannot answer fails the count rather than reading zero" */
    it("fails with the meter's error instead of reporting zeros", async () => {
      const outage = Object.assign(new Error("ClickHouse is down"), { code: "meter_unavailable" });
      const service = eventsServiceOver({
        meter: {
          countByProjects: async () => {
            throw outage;
          },
        },
      });

      await expect(
        service.getCountByProjects({
          organizationId: "org-1",
          projectIds: ["project-1", "project-2"],
        }),
      ).rejects.toMatchObject({ code: "meter_unavailable" });
    });
  });
});

describe("UsageService over the trace meter", () => {
  const projectIds = ["project-1", "project-2", "project-3"];
  const liveCounts = [
    { projectId: "project-1", count: 600 },
    { projectId: "project-2", count: 500 },
    { projectId: "project-3", count: 0 },
  ];

  /** The month's traces on the meter, two span rows each, as the live count would see them. */
  async function meterHolding(): Promise<MemoryTraceMeterRepository> {
    const meter = MemoryTraceMeterRepository.create();
    const month = UsageCountingService.monthOf(Date.now());
    for (const { projectId, count } of liveCounts) {
      for (let trace = 0; trace < count * 2; trace++) {
        const record = {
          organizationId: "org-1",
          tenantId: projectId,
          traceId: `${projectId}-trace-${trace % count}`,
          month,
        };
        await meter.insert({ record, organizationId: "org-1" });
      }
    }
    return meter;
  }

  function overMeter({
    meter,
    allowance,
  }: {
    meter: MemoryTraceMeterRepository;
    allowance: number;
  }) {
    return UsageService.overPeers({
      isSaas: true,
      planResolver: async () => plan(allowance),
      meter: { countByProjects: refuseTraceCount },
      traceMeter: meter,
      peers: {
        billing: createApiFixture<EntitlementUsagePeers["billing"]>({
          getPricingModel: async () => ({ pricingModel: null }),
        }),
      },
      tenancy: {
        findProjectIds: async () => projectIds,
        findMeteredOrganizationIds: async () => ["org-1"],
      },
    });
  }

  function overLiveCount({ allowance }: { allowance: number }) {
    return UsageService.create({
      organizations: organizationsOwning(projectIds),
      traceCounter: new TestCounter(liveCounts),
      eventCounter: new TestCounter(USAGE_UNKNOWN),
      planResolver: async () => plan(allowance),
      deployment: { isSaas: true },
    });
  }

  /** @scenario "The trace meter decides a limit as the live trace count did, over the same traces" */
  it.each([1_000, 1_100, 5_000])(
    "decides an allowance of %i and counts each project as the live count did",
    async (allowance) => {
      const meter = overMeter({ meter: await meterHolding(), allowance });
      const live = overLiveCount({ allowance });

      const decided = await meter.checkLimitForOrganization({ organizationId: "org-1" });
      expect(decided).toEqual(await live.checkLimitForOrganization({ organizationId: "org-1" }));
      expect(decided.exceeded).toBe(allowance <= 1_100);
      await expect(
        meter.getCurrentMonthCountByProjects({ organizationId: "org-1", projectIds }),
      ).resolves.toEqual(liveCounts);
    },
  );
});
