// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }));

vi.mock("@langwatch/observability", () => ({ createLogger: () => logger }));

import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingOrganizationCreatedRepository } from "../../repositories/memory/memory.nurturing-organization-created.repository.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingProjectPlacementRepository } from "../../repositories/memory/memory.nurturing-project-placement.repository.ts";
import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../../repositories/nurturing-organization-member.repository.ts";
import {
  emptyProjectUsage,
  foldProjectUsage,
  TRACE_COUNTING_WINDOW_MS,
} from "../../rules/nurturing-project-usage.rules.ts";
import type {
  NurturingCountedTrace,
  NurturingTraceDay,
} from "../../rules/nurturing-trace-day.rules.ts";
import { NurturingOrganizationUsageService } from "../nurturing-organization-usage.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 12);

/** Each member's organizations, most recently joined first. */
type Memberships = ReadonlyMap<string, readonly string[]>;

/** Nurturing's member copy as the owners' join facts left it: newest join first per member. */
async function membersOver(memberships: Memberships): Promise<MembersCopy> {
  const members = MemoryNurturingOrganizationMemberRepository.create();
  for (const [userId, organizationIds] of memberships) {
    for (const [order, organizationId] of organizationIds.entries()) {
      await members.recordMembershipChange({
        organizationId,
        userId,
        change: "joined",
        at: NOW - (order + 1) * DAY_MS,
      });
    }
  }
  return members;
}

type MembersCopy = Pick<NurturingOrganizationMemberRepository, "findMembershipsOfMembers">;

async function serviceOver({
  placed,
  // Inside its trace counting window, so its trace traits are sent.
  createdAt = new Map([["org-1", NOW - DAY_MS]]),
  send = async () => {},
  members = MemoryNurturingOrganizationMemberRepository.create(),
}: {
  placed: ReadonlyMap<string, string>;
  createdAt?: ReadonlyMap<string, number>;
  send?: (calls: CioBatchCall[]) => Promise<void>;
  members?: MembersCopy;
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
    members,
    sendBatch: async (calls) => {
      await send(calls);
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

/** Arranges one project's trace day by counting its traces and failures, each a new trace. */
async function seedTraceDay(
  traceDays: MemoryNurturingTraceDayRepository,
  {
    projectId,
    day,
    traceCount = 1,
    errorCount = 0,
    lastFailedTraceAt = NOW - DAY_MS,
  }: Pick<NurturingTraceDay, "projectId" | "day"> &
    Partial<Pick<NurturingTraceDay, "traceCount" | "errorCount">> & {
      lastFailedTraceAt?: number;
    },
) {
  const traces = (kind: NurturingCountedTrace["kind"], count: number, at: number) =>
    Array.from({ length: count }, (_, n) => ({
      projectId,
      traceId: `${projectId}:${day}:${n}`,
      kind,
      day,
      at,
    }));
  await traceDays.countTraces([
    ...traces("trace", traceCount, NOW - DAY_MS),
    ...traces("failed", errorCount, lastFailedTraceAt),
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

  /** @scenario "A changed project's old trace days are deleted even without a placement or admin" */
  it("prunes an organization without an admin's project", async () => {
    const { service, traceDays, sent } = await serviceOver({
      placed: new Map([["project-8", "org-without-admin"]]),
    });
    await seedTraceDay(traceDays, { projectId: "project-8", day: "2026-10-01" });

    await service.usageChanged({ projectId: "project-8" });

    await expect(
      traceDays.findForProjects({ projectIds: ["project-8"], afterDay: "2000-01-01" }),
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
    const unseen = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      createdAt: new Map(),
    });
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

  describe("given an organization whose members are Customer.io people", () => {
    const placed = new Map([["project-1", "org-1"]]);

    /** @scenario "Each member of the organization gets its traits as person attributes" */
    it("identifies each member with the organization's traits after the group call", async () => {
      const { service, projectUsage, sent } = await serviceOver({
        placed,
        members: await membersOver(
          new Map([
            ["admin-1", ["org-1", "org-0"]],
            ["member-2", ["org-1"]],
          ]),
        ),
      });
      await projectUsage
        .forOwner("prompt")
        .store(usageOf("project-1", ["p1"]), storeContext("project-1"));

      await service.usageChanged({ projectId: "project-1" });

      const [group, identifies] = sent;
      expect(group).toEqual([expect.objectContaining({ type: "group", groupId: "org-1" })]);
      expect(identifies).toEqual([
        { type: "identify", userId: "admin-1", traits: traitsOf(group?.[0]) },
        { type: "identify", userId: "member-2", traits: traitsOf(group?.[0]) },
      ]);
      expect(traitsOf(identifies?.[0])).toMatchObject({ prompt_count: 1, trace_count: 0 });
    });

    /** @scenario "A member who joined another organization since does not get this one's traits" */
    it("leaves out a member whose most recently joined organization is another", async () => {
      const { service, sent } = await serviceOver({
        placed,
        members: await membersOver(
          new Map([
            ["admin-1", ["org-1"]],
            ["member-2", ["org-2", "org-1"]],
          ]),
        ),
      });

      await service.usageChanged({ projectId: "project-1" });

      expect(sent[1]?.map((call) => call.userId)).toEqual(["admin-1"]);
    });

    /** @scenario "A failed identify is reported and swallowed" */
    it("reports and swallows a refused identify, the group call already sent", async () => {
      logger.warn.mockClear();
      const { service, sent } = await serviceOver({
        placed,
        members: await membersOver(new Map([["admin-1", ["org-1"]]])),
        send: async (calls) => {
          if (calls.some((call) => call.type === "identify")) throw new Error("refused");
        },
      });

      await expect(service.usageChanged({ projectId: "project-1" })).resolves.toBeUndefined();

      expect(sent.map((calls) => calls.map((call) => call.type))).toEqual([["group"]]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" }),
        expect.any(String),
      );
    });

    /** @scenario "A failed identify is reported and swallowed" */
    it("reports and swallows a members read that failed", async () => {
      logger.warn.mockClear();
      const { service, sent } = await serviceOver({
        placed,
        members: {
          findMembershipsOfMembers: () => Promise.reject(new Error("member copy unavailable")),
        },
      });

      await expect(service.usageChanged({ projectId: "project-1" })).resolves.toBeUndefined();

      expect(sent).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  /** @scenario "An organization past its counting window writes no counts" */
  it("sends no trace traits for an organization past its counting window", async () => {
    const { service, traceDays, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      createdAt: new Map([["org-1", NOW - 25 * DAY_MS]]),
    });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-19" });

    await service.usageChanged({ projectId: "project-1" });

    expect(traitsOf(sent[0]?.[0])).not.toHaveProperty("trace_count");
    expect(traitsOf(sent[0]?.[0])).toMatchObject({ prompt_count: 0 });
  });

  describe("when an organization's trace window ends", () => {
    const ended = NOW - TRACE_COUNTING_WINDOW_MS;

    /** @scenario "The trace traits are removed once when an organization's window ends" */
    it("sends its trace traits once as null, on the organization and its members", async () => {
      const { service, sent } = await serviceOver({
        placed: new Map(),
        createdAt: new Map([
          ["org-1", ended],
          ["org-later", ended + 1],
        ]),
        members: await membersOver(new Map([["member-2", ["org-1"]]])),
      });

      await service.traceWindowsEnded({ after: NOW - 60 * 60 * 1000, upTo: NOW });

      const [group, identifies] = sent;
      expect(group).toEqual([
        {
          type: "group",
          userId: "admin-1",
          groupId: "org-1",
          traits: expect.objectContaining({
            trace_count: null,
            active_last_7_days: null,
            has_habit: null,
            active_day_13: null,
          }),
        },
      ]);
      expect(traitsOf(group?.[0])).not.toHaveProperty("prompt_count");
      expect(identifies).toEqual([
        { type: "identify", userId: "member-2", traits: traitsOf(group?.[0]) },
      ]);
      expect(sent).toHaveLength(2);
    });

    /** @scenario "The trace traits are removed once when an organization's window ends" */
    it("drops the organization's trace days and counted traces", async () => {
      const { service, traceDays } = await serviceOver({
        placed: new Map([["project-1", "org-1"]]),
        createdAt: new Map([["org-1", ended]]),
      });
      await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-19" });

      await service.traceWindowsEnded({ after: NOW - 60 * 60 * 1000, upTo: NOW });

      await expect(
        traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" }),
      ).resolves.toEqual([]);
    });

    it("throws when Customer.io refused, so the sweep retries", async () => {
      const { service } = await serviceOver({
        placed: new Map(),
        createdAt: new Map([["org-1", ended]]),
        send: async () => {
          throw new Error("Customer.io unavailable");
        },
      });

      await expect(
        service.traceWindowsEnded({ after: NOW - 60 * 60 * 1000, upTo: NOW }),
      ).rejects.toThrow("Customer.io unavailable");
    });
  });
});
