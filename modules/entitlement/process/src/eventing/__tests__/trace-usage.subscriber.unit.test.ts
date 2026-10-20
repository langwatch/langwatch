/** Spec: modules/entitlement/specs/usage.feature */
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  MONTH_TRACE_IDS_LISTED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryBillableEventsMeterRepository } from "../../repositories/memory/memory.billable-events-meter.repository.ts";
import { MemoryTraceCountRepository } from "../../repositories/memory/memory.trace-count.repository.ts";
import type { TenancyRepository } from "../../repositories/tenancy.repository.ts";
import { TraceUsageService } from "../../services/trace-usage.service.ts";
import { UsageCountingService } from "../../services/usage-counting.service.ts";
import { CountMonthCommand } from "../usage.commands.ts";
import { buildUsagePipeline } from "../usage.pipeline.ts";

const ORGANIZATION = "organization-1";
const OCT_8 = Date.UTC(2026, 9, 8, 12);
const SEP_30 = Date.UTC(2026, 8, 30, 23, 59);

const refuse = async (): Promise<never> => {
  throw new Error("counting is not asked by trace usage");
};

function compose({ placed = true } = {}) {
  const counts = MemoryTraceCountRepository.create();
  const { logger, lines } = createTestLogger();
  const projects: Pick<TenancyRepository, "getProjectPlacement"> = {
    getProjectPlacement: async () =>
      placed
        ? { kind: "placed" as const, organizationId: ORGANIZATION }
        : { kind: "unplaced" as const },
  };
  const pipeline = buildUsagePipeline({
    countMonth: CountMonthCommand.create({
      counting: UsageCountingService.create({
        meter: MemoryBillableEventsMeterRepository.create(),
        traceMeter: counts,
        plans: { getActivePlan: refuse },
        billing: { getPricingModel: refuse },
      }),
    }),
    traceUsage: TraceUsageService.create({ counts, projects, logger }),
    billableEventsMeter: undefined,
    projects,
    send: () => {
      throw new Error("nothing is sent by trace usage");
    },
  });
  const subscribers = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void subscribers.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const deliver = async (name: string, event: Event) => {
    const subscriber = subscribers.get(`entitlement.${name}`);
    expect(subscriber, `no peer subscriber named ${name}`).toBeDefined();
    await subscriber?.handle(event, {
      tenantId: String(event.tenantId),
      aggregateId: event.aggregateId,
    });
  };
  return { counts, lines, subscribers, deliver };
}

function span({
  traceId,
  createdAt,
  id = `span-${traceId}-${createdAt}`,
}: {
  traceId: string;
  createdAt: number;
  id?: string;
}): Event {
  return {
    id,
    aggregateId: traceId,
    aggregateType: "trace",
    tenantId: createTenantId("project-1"),
    createdAt,
    occurredAt: createdAt - 1_000,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    data: {},
  };
}

function monthPage(traceIds: string[]): Event {
  return {
    id: `page-${traceIds.join("-")}`,
    aggregateId: "project-1",
    aggregateType: "trace_project_milestone",
    tenantId: createTenantId("project-1"),
    createdAt: OCT_8,
    occurredAt: OCT_8,
    type: MONTH_TRACE_IDS_LISTED_EVENT_TYPE,
    version: "2026-10-01",
    data: { tenantId: "project-1", projectId: "project-1", month: "2026-10", traceIds },
  };
}

describe("trace usage subscribers", () => {
  describe("when the span subscriber registers", () => {
    /** @scenario "A trace's spans settle into one job per trace" */
    it("debounces jobs per project and trace for 30 seconds, keeping the first span", () => {
      const { subscribers } = compose();
      const subscriber = subscribers.get("entitlement.traceUsageSpan");
      const dedup = subscriber?.options?.deduplication;

      expect(subscriber?.eventTypes).toEqual([SPAN_RECEIVED_EVENT_TYPE]);
      expect(subscriber?.options?.delay).toBe(30_000);
      expect(dedup).toMatchObject({ ttlMs: 30_000, replace: false });
      const makeId = typeof dedup === "object" ? dedup.makeId : undefined;
      const first = makeId?.(span({ traceId: "trace-1", createdAt: OCT_8 }));
      expect(makeId?.(span({ traceId: "trace-1", createdAt: OCT_8 + 5_000 }))).toBe(first);
      expect(makeId?.(span({ traceId: "trace-2", createdAt: OCT_8 }))).not.toBe(first);
    });
  });

  describe("when a member project holds the traces of an aggregate project", () => {
    /** @scenario "Billing stays with the owning project" */
    it("counts the trace against the member and writes nothing for the aggregate", async () => {
      const { counts, deliver } = compose();

      await deliver("traceUsageSpan", span({ traceId: "trace-1", createdAt: OCT_8 }));

      const countFor = (projectId: string) =>
        counts.rows.filter((row) => row.projectId === projectId).length;
      expect(countFor("project-1")).toBe(1);
      expect(countFor("aggregate-project-1")).toBe(0);
    });
  });

  describe("when a span job runs", () => {
    /** @scenario "A trace's span writes one usage row for its project and month" */
    it("writes one row for the trace in the month the span was appended", async () => {
      const { counts, deliver } = compose();

      await deliver("traceUsageSpan", span({ traceId: "trace-1", createdAt: OCT_8 }));

      expect(counts.rows).toEqual([
        {
          organizationId: ORGANIZATION,
          projectId: "project-1",
          month: "2026-10",
          traceId: "trace-1",
        },
      ]);
    });
  });

  describe("when the upgrade's page of trace ids is delivered", () => {
    /** @scenario "The upgrade's trace ids write one row per trace" */
    it("writes one row per trace id for the project and month", async () => {
      const { counts, deliver } = compose();

      await deliver("traceUsageMonthIds", monthPage(["trace-1", "trace-2", "trace-3"]));

      expect(counts.rows.map(({ traceId, month }) => `${month}/${traceId}`)).toEqual([
        "2026-10/trace-1",
        "2026-10/trace-2",
        "2026-10/trace-3",
      ]);
    });
  });

  describe("when the same trace is written several times", () => {
    /** @scenario "The month counts distinct traces, however often each was written" */
    it("counts each trace once", async () => {
      const { counts, deliver } = compose();
      const first = span({ traceId: "trace-1", createdAt: OCT_8, id: "span-a" });

      await deliver("traceUsageSpan", first);
      await deliver("traceUsageSpan", first);
      await deliver("traceUsageSpan", span({ traceId: "trace-1", createdAt: OCT_8 + 60_000 }));
      await deliver("traceUsageSpan", span({ traceId: "trace-2", createdAt: OCT_8 }));
      await deliver("traceUsageMonthIds", monthPage(["trace-1", "trace-2", "trace-3"]));

      await expect(
        counts.findTotal({ organizationId: ORGANIZATION, month: "2026-10" }),
      ).resolves.toBe(3);
      await expect(
        counts.countByProjects({
          organizationId: ORGANIZATION,
          projectIds: ["project-1", "project-2"],
          month: "2026-10",
        }),
      ).resolves.toEqual([{ projectId: "project-1", count: 3 }]);
    });
  });

  describe("when a trace was already seen last month", () => {
    /** @scenario "A trace counts in the first month it was seen" */
    it("counts only traces first seen this month", async () => {
      const { counts, deliver } = compose();

      await deliver("traceUsageSpan", span({ traceId: "old", createdAt: SEP_30 }));
      await deliver("traceUsageSpan", span({ traceId: "old", createdAt: OCT_8 }));
      await deliver("traceUsageSpan", span({ traceId: "new", createdAt: OCT_8 }));

      await expect(
        counts.findTotal({ organizationId: ORGANIZATION, month: "2026-10" }),
      ).resolves.toBe(1);
      await expect(
        counts.findTotal({ organizationId: ORGANIZATION, month: "2026-09" }),
      ).resolves.toBe(1);
    });
  });

  describe("when the project belongs to no organization", () => {
    /** @scenario "A trace from a project in no organization is skipped, loudly" */
    it("writes no row and warns naming the project", async () => {
      const { counts, lines, deliver } = compose({ placed: false });

      await deliver("traceUsageSpan", span({ traceId: "trace-1", createdAt: OCT_8 }));

      expect(counts.rows).toEqual([]);
      expect(lines.findLine("warn", "trace not counted")).toMatchObject({ projectId: "project-1" });
    });
  });
});
