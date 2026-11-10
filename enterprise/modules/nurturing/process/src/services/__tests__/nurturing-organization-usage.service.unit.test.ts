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
import {
  emptyTraceDay,
  type NurturingTraceDayState,
} from "../../rules/nurturing-trace-day.rules.ts";
import { NurturingOrganizationUsageService } from "../nurturing-organization-usage.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 12);

type TraceRead = Parameters<TraceApi["findTraceUsageByDay"]>[0];

/** Trace's cost read, answering `days` and keeping each read it was asked for. */
function fakeTraces(days: readonly TraceUsageDay[]) {
  const reads: TraceRead[] = [];
  return {
    reads,
    findTraceUsageByDay: async (input: TraceRead) => {
      reads.push(input);
      return [...days];
    },
  };
}

async function serviceOver({
  placed,
  costs = [],
  send = async () => {},
}: {
  placed: ReadonlyMap<string, string>;
  costs?: readonly TraceUsageDay[];
  send?: () => Promise<void>;
}) {
  const projectUsage = MemoryNurturingProjectUsageRepository.create();
  const traceDays = MemoryNurturingTraceDayRepository.create();
  const traces = fakeTraces(costs);
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

const costDay = (day: string, totalCost: number): TraceUsageDay => ({
  day,
  traceCount: 1,
  errorCount: 0,
  totalCost,
  lastTraceAt: NOW - DAY_MS,
  lastFailedTraceAt: null,
});

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
    expect(traces.reads).toEqual([]);
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
      costs: [costDay("2026-11-18", 0.5), costDay("2026-11-19", 0.25)],
    });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-19" });

    await service.usageChanged({ projectId: "project-1" });
    await service.usageChanged({ projectId: "project-2" });

    expect(traces.reads).toEqual([
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

    expect(traces.reads).toHaveLength(2);
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
