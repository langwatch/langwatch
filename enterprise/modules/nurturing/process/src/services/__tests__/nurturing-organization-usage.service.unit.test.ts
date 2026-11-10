// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import type { TraceApi, TraceUsageDay } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { traceDayKey } from "../../repositories/nurturing-trace-day.repository.ts";
import { emptyProjectUsage, foldProjectUsage } from "../../rules/nurturing-project-usage.rules.ts";
import { utcDayOf } from "../../rules/nurturing-time.rules.ts";
import {
  emptyTraceDay,
  type NurturingTraceDayState,
} from "../../rules/nurturing-trace-day.rules.ts";
import { NurturingOrganizationUsageService } from "../nurturing-organization-usage.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 12);

type TraceRead = Parameters<TraceApi["findTraceUsageByDay"]>[0];

/** One minute of trace's rollup: a project's root spans that started in it. */
type RollupMinute = Readonly<{
  projectId: string;
  at: number;
  traces?: number;
  failed?: number;
  cost?: number;
}>;

/** Trace's rollup read over `minutes`, per UTC day, keeping each read it was asked for. */
function fakeTraces(minutes: readonly RollupMinute[]) {
  const reads: TraceRead[] = [];
  return {
    reads,
    /** The once-a-day cost reads: every read but a seed's, which is bounded by `untilMs`. */
    costReads: () => reads.filter((read) => read.untilMs === undefined),
    seedReads: () => reads.filter((read) => read.untilMs !== undefined),
    findTraceUsageByDay: async (input: TraceRead): Promise<TraceUsageDay[]> => {
      reads.push(input);
      const days = new Map<string, TraceUsageDay>();
      for (const minute of minutes) {
        if (!input.projectIds.includes(minute.projectId) || minute.at < input.sinceMs) continue;
        if (input.untilMs !== undefined && minute.at >= input.untilMs) continue;
        const day = utcDayOf(minute.at);
        const known = days.get(day);
        days.set(day, {
          day,
          traceCount: (known?.traceCount ?? 0) + (minute.traces ?? 1),
          errorCount: (known?.errorCount ?? 0) + (minute.failed ?? 0),
          totalCost: (known?.totalCost ?? 0) + (minute.cost ?? 0),
          lastTraceAt: Math.max(known?.lastTraceAt ?? 0, minute.at),
          lastFailedTraceAt: known?.lastFailedTraceAt ?? null,
        });
      }
      return [...days.values()];
    },
  };
}

async function serviceOver({
  placed,
  rollup = [],
  send = async () => {},
}: {
  placed: ReadonlyMap<string, string>;
  rollup?: readonly RollupMinute[];
  send?: () => Promise<void>;
}) {
  const projectUsage = MemoryNurturingProjectUsageRepository.create();
  const traceDays = MemoryNurturingTraceDayRepository.create();
  const traces = fakeTraces(rollup);
  const milestones = MemoryNurturingMilestonesRepository.create();
  await milestones.recordOrganization({
    organizationId: "org-1",
    adminUserId: "admin-1",
    seeded: false,
  });
  const sent: CioBatchCall[][] = [];
  const service = NurturingOrganizationUsageService.create({
    projectUsage,
    traceDays,
    traces,
    claims: MemoryNurturingClaimRepository.create(),
    projects: MemoryNurturingProjectDirectoryRepository.create({ placed }),
    milestones,
    sendBatch: async (calls) => {
      await send();
      sent.push(calls);
    },
    clock: { nowMs: () => NOW },
  });
  return { service, projectUsage, traceDays, traces, sent };
}

const usageOf = (projectId: string, promptIds: readonly string[]) =>
  promptIds.reduce(
    (state, promptId) =>
      foldProjectUsage(state, { kind: "prompt_created", promptId, occurredAt: NOW }),
    emptyProjectUsage(projectId),
  );

const traitsOf = (call: CioBatchCall | undefined) =>
  call && "traits" in call ? call.traits : undefined;

const storeContext = (key: string) => ({ aggregateId: key, tenantId: createTenantId(key), key });

/** Seeds one project's trace day as the trace-day fold would have stored it. */
async function seedTraceDay(
  traceDays: MemoryNurturingTraceDayRepository,
  day: Partial<NurturingTraceDayState> & Pick<NurturingTraceDayState, "projectId" | "day">,
) {
  const state = { ...emptyTraceDay(), traceCount: 1, lastTraceAt: NOW - DAY_MS, ...day };
  await traceDays.store.store(state, storeContext(traceDayKey(state)));
}

describe("NurturingOrganizationUsageService", () => {
  /** @scenario "A changed project sends its organization's traits as one group call on the admin" */
  it("sends one group call on the admin with the organization's summed traits", async () => {
    const { service, projectUsage, traces, sent } = await serviceOver({
      placed: new Map([
        ["project-1", "org-1"],
        ["project-2", "org-1"],
      ]),
    });
    await projectUsage
      .forOwner("prompt")
      .store(usageOf("project-1", ["p1", "p2"]), storeContext("project-1"));
    await projectUsage
      .forOwner("prompt")
      .store(usageOf("project-2", ["p3"]), storeContext("project-2"));

    await service.usageChanged({ projectId: "project-1" });

    expect(sent).toEqual([
      [
        {
          type: "group",
          userId: "admin-1",
          groupId: "org-1",
          traits: expect.objectContaining({ prompt_count: 3, trace_count: 0, total_cost: 0 }),
        },
      ],
    ]);
    expect(traces.costReads()).toEqual([]);
  });

  /** @scenario "The organization's traits sum its projects' trace days" */
  it("sums its projects' trace days in the window into the trace traits", async () => {
    const { service, traceDays, sent } = await serviceOver({
      placed: new Map([
        ["project-1", "org-1"],
        ["project-2", "org-1"],
      ]),
    });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-18", traceCount: 2 });
    await seedTraceDay(traceDays, {
      projectId: "project-2",
      day: "2026-11-19",
      errorCount: 1,
      lastFailedTraceAt: NOW - DAY_MS,
    });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-10-01", traceCount: 9 });

    await service.usageChanged({ projectId: "project-2" });

    expect(traitsOf(sent[0]?.[0])).toMatchObject({
      trace_count: 3,
      error_count: 1,
      last_failed_trace_at: Math.floor((NOW - DAY_MS) / 1000),
    });
  });

  /** @scenario "Trace days older than the window are deleted" */
  it("deletes the organization's trace days older than the window", async () => {
    const { service, traceDays } = await serviceOver({ placed: new Map([["project-1", "org-1"]]) });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-10-01" });

    await service.usageChanged({ projectId: "project-1" });

    await expect(
      traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "2000-01-01" }),
    ).resolves.toEqual([]);
  });

  /** @scenario "The window's cost is read from trace once per organization and UTC day" */
  it("reads the window's cost once a day, and leaves total_cost out of later syncs", async () => {
    const { service, traceDays, traces, sent } = await serviceOver({
      placed: new Map([
        ["project-1", "org-1"],
        ["project-2", "org-1"],
      ]),
      rollup: [
        { projectId: "project-1", at: NOW - 2 * DAY_MS, cost: 0.5 },
        { projectId: "project-2", at: NOW - DAY_MS, cost: 0.25 },
      ],
    });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-19" });

    await service.usageChanged({ projectId: "project-1" });
    await service.usageChanged({ projectId: "project-2" });

    expect(traces.costReads()).toEqual([
      {
        organizationId: "org-1",
        projectIds: ["project-1", "project-2"],
        sinceMs: NOW - 30 * DAY_MS,
      },
    ]);
    expect(traitsOf(sent[0]?.[0])).toMatchObject({ total_cost: 0.75 });
    expect(traitsOf(sent[1]?.[0])).not.toHaveProperty("total_cost");
  });

  it("reads the cost again on the next try when Customer.io refused the call", async () => {
    let refuse = true;
    const { service, traceDays, traces } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      send: async () => {
        if (refuse) throw new Error("Customer.io unavailable");
      },
    });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-19" });

    await expect(service.usageChanged({ projectId: "project-1" })).rejects.toThrow();
    refuse = false;
    await service.usageChanged({ projectId: "project-1" });

    expect(traces.costReads()).toHaveLength(2);
  });

  /** @scenario "Prompt versions, scenario runs and evaluations count toward the habit" */
  it("counts the projects' evaluation days with the trace days for has_habit", async () => {
    const { service, projectUsage, traceDays, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
    });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-10" });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-13" });
    await projectUsage.recordEvaluationDay({
      projectId: "project-1",
      occurredAt: Date.UTC(2026, 10, 17, 9),
    });

    await service.usageChanged({ projectId: "project-1" });

    expect(sent[0]?.[0]).toMatchObject({ traits: { has_habit: true } });
  });

  /** @scenario "A project that traced before the fold started is seeded once from trace's rollup" */
  it("seeds each project once from the rollup, so traces from before the fold are counted", async () => {
    const { service, traces, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      rollup: [
        { projectId: "project-1", at: Date.UTC(2026, 10, 15, 9), traces: 2, failed: 1 },
        { projectId: "project-1", at: Date.UTC(2026, 10, 17, 9) },
      ],
    });

    await service.usageChanged({ projectId: "project-1" });
    await service.usageChanged({ projectId: "project-1" });

    expect(traces.seedReads()).toEqual([
      {
        organizationId: "org-1",
        projectIds: ["project-1"],
        sinceMs: NOW - 30 * DAY_MS,
        untilMs: NOW,
      },
    ]);
    expect(traitsOf(sent[0]?.[0])).toMatchObject({ trace_count: 3, error_count: 1 });
    expect(traitsOf(sent[1]?.[0])).toMatchObject({ trace_count: 3, error_count: 1 });
  });

  /** @scenario "The fold's first day counts traces before and after the fold started, each once" */
  it("counts the rollup's traces before the fold's first trace and the fold's after it", async () => {
    // The fold started 10:30 on 11-20: 2 traces before it, and 3 after it that both count.
    const foldStart = Date.UTC(2026, 10, 20, 10, 30, 20);
    const { service, traceDays, traces, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      rollup: [
        { projectId: "project-1", at: Date.UTC(2026, 10, 20, 8) },
        { projectId: "project-1", at: Date.UTC(2026, 10, 20, 9) },
        { projectId: "project-1", at: Date.UTC(2026, 10, 20, 10, 30) },
        { projectId: "project-1", at: Date.UTC(2026, 10, 20, 11) },
        { projectId: "project-1", at: Date.UTC(2026, 10, 20, 11, 30) },
      ],
    });
    await seedTraceDay(traceDays, {
      projectId: "project-1",
      day: "2026-11-20",
      traceCount: 3,
      firstTraceAt: foldStart,
      lastTraceAt: Date.UTC(2026, 10, 20, 11, 30),
    });

    await service.usageChanged({ projectId: "project-1" });

    expect(traces.seedReads()[0]?.untilMs).toBe(Date.UTC(2026, 10, 20, 10, 30));
    expect(traitsOf(sent[0]?.[0])).toMatchObject({ trace_count: 5 });
  });

  /** @scenario "The fold's first day counts traces before and after the fold started, each once" */
  it("adds nothing from the rollup for a project the fold saw from its first trace", async () => {
    const { service, traceDays, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      rollup: [{ projectId: "project-1", at: Date.UTC(2026, 10, 19, 9), traces: 4 }],
    });
    await seedTraceDay(traceDays, {
      projectId: "project-1",
      day: "2026-11-19",
      traceCount: 4,
      firstTraceAt: Date.UTC(2026, 10, 19, 9, 0, 5),
    });

    await service.usageChanged({ projectId: "project-1" });

    expect(traitsOf(sent[0]?.[0])).toMatchObject({ trace_count: 4 });
  });

  /** @scenario "A project placed in no organization sends nothing" */
  it("sends nothing for a project placed in no organization", async () => {
    const { service, projectUsage, traces, sent } = await serviceOver({ placed: new Map() });
    await projectUsage
      .forOwner("prompt")
      .store(usageOf("project-9", ["p1"]), storeContext("project-9"));

    await service.usageChanged({ projectId: "project-9" });

    expect(sent).toEqual([]);
    expect(traces.reads).toEqual([]);
  });
});
