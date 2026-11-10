// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import type { TraceApi, TraceUsageDay } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import { emptyProjectUsage, foldProjectUsage } from "../../rules/nurturing-project-usage.rules.ts";
import { NurturingOrganizationUsageService } from "../nurturing-organization-usage.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 12);

type TraceRead = Parameters<TraceApi["findTraceUsageByDay"]>[0];

/** Trace's per-day read, answering `days` and keeping each read it was asked for. */
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
  days = [],
}: {
  placed: ReadonlyMap<string, string>;
  days?: readonly TraceUsageDay[];
}) {
  const projectUsage = MemoryNurturingProjectUsageRepository.create();
  const traces = fakeTraces(days);
  const milestones = MemoryNurturingMilestonesRepository.create();
  await milestones.recordOrganization({
    organizationId: "org-1",
    adminUserId: "admin-1",
    seeded: false,
  });
  const sent: CioBatchCall[][] = [];
  const service = NurturingOrganizationUsageService.create({
    projectUsage,
    traces,
    projects: MemoryNurturingProjectDirectoryRepository.create({ placed }),
    milestones,
    sendBatch: async (calls) => void sent.push(calls),
    clock: { nowMs: () => NOW },
  });
  return { service, projectUsage, traces, sent };
}

const usageOf = (projectId: string, promptIds: readonly string[]) =>
  promptIds.reduce(
    (state, promptId) =>
      foldProjectUsage(state, { kind: "prompt_created", promptId, occurredAt: NOW }),
    emptyProjectUsage(projectId),
  );

const traitsOf = (call: CioBatchCall | undefined) =>
  call && "traits" in call ? call.traits : undefined;

const storeContext = (projectId: string) =>
  ({ aggregateId: projectId, tenantId: projectId }) as never;

const day = (overrides: Partial<TraceUsageDay> & Pick<TraceUsageDay, "day">): TraceUsageDay => ({
  traceCount: 1,
  errorCount: 0,
  totalCost: 0,
  lastTraceAt: Date.parse(`${overrides.day}T10:00:00Z`),
  lastFailedTraceAt: null,
  ...overrides,
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
          traits: expect.objectContaining({ prompt_count: 3 }),
        },
      ],
    ]);
    expect(traces.reads).toEqual([]);
  });

  /** @scenario "A sync no trace started leaves the trace traits as Customer.io has them" */
  it("reads no traces and sends no trace trait when an owner fact changed", async () => {
    const { service, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      days: [day({ day: "2026-11-19" })],
    });

    await service.usageChanged({ projectId: "project-1" });

    expect(traitsOf(sent[0]?.[0])).toHaveProperty("prompt_count", 0);
    expect(traitsOf(sent[0]?.[0])).not.toHaveProperty("trace_count");
    expect(traitsOf(sent[0]?.[0])).not.toHaveProperty("has_habit");
  });

  /** @scenario "The organization's traces are read from trace's rollup" */
  it("reads its organization's last 30 days of traces once and sends them", async () => {
    const { service, projectUsage, traces, sent } = await serviceOver({
      placed: new Map([
        ["project-1", "org-1"],
        ["project-2", "org-1"],
      ]),
      days: [
        day({ day: "2026-11-18", traceCount: 2, errorCount: 1, totalCost: 0.5 }),
        day({ day: "2026-11-19", totalCost: 0.25 }),
      ],
    });
    await projectUsage
      .forOwner("prompt")
      .store(usageOf("project-1", ["p1"]), storeContext("project-1"));

    await service.tracesChanged({ projectId: "project-2" });

    expect(traces.reads).toEqual([
      {
        organizationId: "org-1",
        projectIds: ["project-1", "project-2"],
        sinceMs: NOW - 30 * DAY_MS,
      },
    ]);
    expect(sent[0]?.[0]).toMatchObject({
      groupId: "org-1",
      traits: { prompt_count: 1, trace_count: 3, error_count: 1, total_cost: 0.75 },
    });
  });

  /** @scenario "Prompt versions, scenario runs and evaluations count toward the habit" */
  it("counts the projects' evaluation days with the trace days for has_habit", async () => {
    const { service, projectUsage, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      days: [day({ day: "2026-11-10" }), day({ day: "2026-11-13" })],
    });
    await projectUsage.recordEvaluationDay({
      projectId: "project-1",
      occurredAt: Date.UTC(2026, 10, 17, 9),
    });

    await service.tracesChanged({ projectId: "project-1" });

    expect(sent[0]?.[0]).toMatchObject({ traits: { has_habit: true } });
  });

  /** @scenario "A project placed in no organization sends nothing" */
  it("sends nothing for a project placed in no organization", async () => {
    const { service, projectUsage, traces, sent } = await serviceOver({ placed: new Map() });
    await projectUsage
      .forOwner("prompt")
      .store(usageOf("project-9", ["p1"]), storeContext("project-9"));

    await service.usageChanged({ projectId: "project-9" });
    await service.tracesChanged({ projectId: "project-9" });

    expect(sent).toEqual([]);
    expect(traces.reads).toEqual([]);
  });
});
