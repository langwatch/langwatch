// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingOrganizationCreatedRepository } from "../../repositories/memory/memory.nurturing-organization-created.repository.ts";
import { MemoryNurturingProjectPlacementRepository } from "../../repositories/memory/memory.nurturing-project-placement.repository.ts";
import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import { emptyProjectUsage, foldProjectUsage } from "../../rules/nurturing-project-usage.rules.ts";
import { emptyTraceDay, type NurturingTraceDay } from "../../rules/nurturing-trace-day.rules.ts";
import { NurturingOrganizationUsageService } from "../nurturing-organization-usage.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 12);

async function serviceOver({
  placed,
  createdAt = new Map(),
  send = async () => {},
}: {
  placed: ReadonlyMap<string, string>;
  createdAt?: ReadonlyMap<string, number>;
  send?: () => Promise<void>;
}) {
  const projectUsage = MemoryNurturingProjectUsageRepository.create();
  const traceDays = MemoryNurturingTraceDayRepository.create();
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
    placements: MemoryNurturingProjectPlacementRepository.create({ placed }),
    organizationsCreated: MemoryNurturingOrganizationCreatedRepository.create({ createdAt }),
    milestones,
    sendBatch: async (calls) => {
      await send();
      sent.push(calls);
    },
    clock: { nowMs: () => NOW },
  });
  return { service, projectUsage, traceDays, sent };
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

/** Arranges one project's trace day as its counted traces would have left it. */
async function seedTraceDay(
  traceDays: MemoryNurturingTraceDayRepository,
  day: Partial<NurturingTraceDay> & Pick<NurturingTraceDay, "projectId" | "day">,
) {
  await traceDays.addTraceDays([
    { ...emptyTraceDay(), traceCount: 1, lastTraceAt: NOW - DAY_MS, ...day },
  ]);
}

describe("NurturingOrganizationUsageService", () => {
  /** @scenario "A changed project sends its organization's traits as one group call on the admin" */
  it("sends one group call on the admin with the organization's summed traits", async () => {
    const { service, projectUsage, sent } = await serviceOver({
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
          traits: expect.objectContaining({ prompt_count: 3, trace_count: 0 }),
        },
      ],
    ]);
    expect(traitsOf(sent[0]?.[0])).not.toHaveProperty("total_cost");
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

  /** @scenario "A changed project's old trace days are deleted even without a placement or admin" */
  it("prunes an unplaced project's old trace days", async () => {
    const { service, traceDays, sent } = await serviceOver({ placed: new Map() });
    await seedTraceDay(traceDays, { projectId: "project-9", day: "2026-10-01" });

    await service.usageChanged({ projectId: "project-9" });

    await expect(
      traceDays.findForProjects({ projectIds: ["project-9"], afterDay: "2000-01-01" }),
    ).resolves.toEqual([]);
    expect(sent).toEqual([]);
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

  it("throws when Customer.io refused the call, so the subscriber's job retries", async () => {
    let refuse = true;
    const { service, traceDays, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      send: async () => {
        if (refuse) throw new Error("Customer.io unavailable");
      },
    });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-19" });

    await expect(service.usageChanged({ projectId: "project-1" })).rejects.toThrow(
      "Customer.io unavailable",
    );
    refuse = false;
    await service.usageChanged({ projectId: "project-1" });

    expect(traitsOf(sent[0]?.[0])).toMatchObject({ trace_count: 1 });
  });

  /** @scenario "The signup day comes from the organization's creation fact" */
  it("sends signup-day traits only for an organization nurturing saw created", async () => {
    const seen = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      createdAt: new Map([["org-1", NOW - 3 * DAY_MS]]),
    });
    const unseen = await serviceOver({ placed: new Map([["project-1", "org-1"]]) });
    for (const { traceDays } of [seen, unseen]) {
      await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-20" });
    }

    await seen.service.usageChanged({ projectId: "project-1" });
    await unseen.service.usageChanged({ projectId: "project-1" });

    expect(traitsOf(seen.sent[0]?.[0])).toMatchObject({ back_since_day_0: true });
    expect(traitsOf(unseen.sent[0]?.[0])).not.toHaveProperty("back_since_day_0");
  });

  /** @scenario "A project nurturing never saw created sends nothing" */
  it("sends nothing for a project nurturing never saw created", async () => {
    const { service, projectUsage, sent } = await serviceOver({ placed: new Map() });
    await projectUsage
      .forOwner("prompt")
      .store(usageOf("project-9", ["p1"]), storeContext("project-9"));

    await service.usageChanged({ projectId: "project-9" });

    expect(sent).toEqual([]);
  });
});
