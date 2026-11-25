// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryNurturingErasedUserRepository } from "../../repositories/memory/memory.nurturing-erased-user.repository.ts";
import { MemoryNurturingEvaluationDayRepository } from "../../repositories/memory/memory.nurturing-evaluation-day.repository.ts";
import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingOrganizationCreatedRepository } from "../../repositories/memory/memory.nurturing-organization-created.repository.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingProjectPlacementRepository } from "../../repositories/memory/memory.nurturing-project-placement.repository.ts";
import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingClaimRepository } from "../../repositories/nurturing-claim.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../../repositories/nurturing-organization-member.repository.ts";
import {
  emptyProjectUsage,
  foldProjectUsage,
  TRACE_COUNTING_WINDOW_MS,
} from "../../rules/nurturing-project-usage.rules.ts";
import { type NurturingTraceDay, traceDayKeyOf } from "../../rules/nurturing-trace-day.rules.ts";
import { NurturingCopiedProjectsService } from "../nurturing-copied-projects.service.ts";
import { NurturingOrganizationUsageService } from "../nurturing-organization-usage.service.ts";

type UsageDependencies = Parameters<typeof NurturingOrganizationUsageService.create>[0];

/** The service's logger, to read what it reported. */
const { logger, lines } = createTestLogger();

const DEBUG = 20;
const INFO = 30;
const WARN = 40;
const PINO_KEYS = new Set(["level", "time", "pid", "hostname", "msg"]);

/** A run's own logger and counter, so each test reads only what its run reported. */
function runObserved() {
  const { logger: runLogger, lines: runLines } = createTestLogger();
  const outcomes: Record<string, unknown>[] = [];
  const syncs: UsageDependencies["syncs"] = {
    inc: (attributes) => void outcomes.push(attributes ?? {}),
  };
  const at = (level: number) => runLines.filter((line) => line.level === level);
  /** Keys of the info and debug payloads and of the counter's attributes, pino's own left out. */
  const payloadKeys = () => [
    ...[...at(INFO), ...at(DEBUG)].flatMap((line) =>
      Object.keys(line).filter((key) => !PINO_KEYS.has(key)),
    ),
    ...outcomes.flatMap((attributes) => Object.keys(attributes)),
  ];
  /** Every info and debug line and counter attribute set as text, to search for ids. */
  const serialised = () =>
    JSON.stringify([
      ...[...at(INFO), ...at(DEBUG)].map((line) =>
        Object.fromEntries(
          Object.entries(line).filter(([key]) => key === "msg" || !PINO_KEYS.has(key)),
        ),
      ),
      ...outcomes,
    ]);
  return { logger: runLogger, syncs, outcomes, at, payloadKeys, serialised };
}

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

type TrackCall = Extract<CioBatchCall, { type: "track" }>;

async function serviceOver({
  placed,
  // Inside its trace counting window, so its trace traits are sent.
  createdAt = new Map([["org-1", NOW - DAY_MS]]),
  send = async () => {},
  members = MemoryNurturingOrganizationMemberRepository.create(),
  logger: serviceLogger = logger,
  syncs = { inc: () => {} },
  milestonesFailure,
  claims = MemoryNurturingClaimRepository.create(),
}: {
  placed: ReadonlyMap<string, string>;
  createdAt?: ReadonlyMap<string, number>;
  send?: (calls: CioBatchCall[]) => Promise<void>;
  members?: MembersCopy;
  logger?: UsageDependencies["logger"];
  syncs?: UsageDependencies["syncs"];
  /** Makes reading the organization's admin throw, as a repository outage would. */
  milestonesFailure?: Error;
  claims?: NurturingClaimRepository;
}) {
  const projectUsage = MemoryNurturingProjectUsageRepository.create();
  const traceDays = MemoryNurturingTraceDayRepository.create();
  const evaluationDays = MemoryNurturingEvaluationDayRepository.create();
  const milestones = MemoryNurturingMilestonesRepository.create();
  await milestones.recordOrganization({
    organizationId: "org-1",
    adminUserId: "admin-1",
    seeded: false,
  });
  const sent: CioBatchCall[][] = [];
  const placements = MemoryNurturingProjectPlacementRepository.create({ placed });
  const organizationsCreated = MemoryNurturingOrganizationCreatedRepository.create({ createdAt });
  const service = NurturingOrganizationUsageService.create({
    projectUsage,
    traceDays,
    evaluationDays,
    copiedProjects: NurturingCopiedProjectsService.create({ placements, organizationsCreated }),
    placements,
    organizationsCreated,
    milestones: milestonesFailure
      ? createApiFixture<UsageDependencies["milestones"]>({
          findOrganization: () => Promise.reject(milestonesFailure),
        })
      : milestones,
    members,
    erasedUsers: MemoryNurturingErasedUserRepository.create(),
    claims,
    sendBatch: async (calls) => {
      await send(calls);
      sent.push(calls);
    },
    clock: { nowMs: () => NOW },
    logger: serviceLogger,
    syncs,
  });
  return { service, projectUsage, traceDays, evaluationDays, sent };
}

const usageOf = (projectId: string, promptIds: readonly string[]) =>
  promptIds.reduce(
    (state, promptId) =>
      foldProjectUsage(state, { kind: "prompt_created", promptId, occurredAt: NOW }),
    emptyProjectUsage(projectId),
  );

const traitsOf = (call: CioBatchCall | undefined) =>
  call && "traits" in call ? call.traits : undefined;

/** The traits only the company's group call carries, never a member's identify. */
const COMPANY_KEYS = ["project_count", "created_at"];

/** A group call's traits without the company's own, as the members are told them. */
const memberTraitsOf = (call: CioBatchCall | undefined) =>
  Object.fromEntries(
    Object.entries(traitsOf(call) ?? {}).filter(([key]) => !COMPANY_KEYS.includes(key)),
  );

const storeContext = (key: string) => ({ aggregateId: key, tenantId: createTenantId(key), key });

/** Arranges one project's trace day as the two trace-day folds store it: spans and failures rows. */
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
  const key = traceDayKeyOf({ projectId, day });
  const context = { aggregateId: key, tenantId: createTenantId(projectId), key };
  const empty = { projectId, day, traceCount: 0, errorCount: 0, lastTraceAt: null };
  await traceDays
    .forSource("spans")
    .store({ ...empty, traceCount, lastTraceAt: NOW - DAY_MS, lastFailedTraceAt: null }, context);
  await traceDays.forSource("failures").store({ ...empty, errorCount, lastFailedTraceAt }, context);
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

  /** Created 60 days before NOW: its window ended on 2026-10-12, the day a late trace left. */
  const longEnded = new Map([
    ["org-1", NOW - 60 * DAY_MS],
    ["org-without-admin", NOW - 60 * DAY_MS],
  ]);

  /** @scenario "Trace days older than the window are deleted" */
  it("deletes an organization's trace days older than the window, once past its counting window", async () => {
    const { service, traceDays } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      createdAt: longEnded,
    });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-10-12" });

    await service.usageChanged({ projectId: "project-1" });

    await expect(
      traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "2000-01-01" }),
    ).resolves.toEqual([]);
  });

  /** @scenario "A sync past the counting window deletes old trace days, even without an admin" */
  it("prunes an organization without an admin's old trace days and sends nothing", async () => {
    const { service, traceDays, sent } = await serviceOver({
      placed: new Map([["project-8", "org-without-admin"]]),
      createdAt: longEnded,
    });
    await seedTraceDay(traceDays, { projectId: "project-8", day: "2026-10-12" });

    await service.usageChanged({ projectId: "project-8" });

    await expect(
      traceDays.findForProjects({ projectIds: ["project-8"], afterDay: "2000-01-01" }),
    ).resolves.toEqual([]);
    expect(sent).toEqual([]);
  });

  /** @scenario "Evaluation days are dropped once their organization's window has passed" */
  it("drops every evaluation day of an organization past its counting window", async () => {
    const { service, evaluationDays } = await serviceOver({
      placed: new Map([["project-8", "org-1"]]),
      createdAt: longEnded,
    });
    await evaluationDays.recordDays([
      { projectId: "project-8", day: "2026-10-12" },
      { projectId: "project-8", day: "2026-11-18" },
    ]);

    await service.usageChanged({ projectId: "project-8" });

    await expect(
      evaluationDays.findForProjects({ projectIds: ["project-8"], afterDay: "2000-01-01" }),
    ).resolves.toEqual([]);
  });

  /** @scenario "A sync past the counting window deletes old trace days, even without an admin" */
  it("prunes nothing inside the counting window, where no day can be older than the window", async () => {
    const { service, traceDays } = await serviceOver({ placed: new Map([["project-1", "org-1"]]) });
    // Unreachable in production: it only shows the sync leaves the drop to the window-end sweep.
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-10-01" });

    await service.usageChanged({ projectId: "project-1" });

    await expect(
      traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "2000-01-01" }),
    ).resolves.toEqual([expect.objectContaining({ day: "2026-10-01" })]);
  });

  /** @scenario "Prompt versions, scenario runs and evaluations count toward the habit" */
  it("counts the projects' evaluation days with the trace days for has_habit", async () => {
    const { service, evaluationDays, traceDays, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
    });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-10" });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-13" });
    await evaluationDays.recordDay({ projectId: "project-1", day: "2026-11-17" });

    await service.usageChanged({ projectId: "project-1" });

    expect(sent[0]?.[0]).toMatchObject({ traits: { has_habit: true } });
  });

  /** @scenario "Prompt versions, scenario runs and evaluations count toward the habit" */
  it("leaves out an evaluation day older than the window, as the trace days are", async () => {
    const { service, evaluationDays, traceDays, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
    });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-10" });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-13" });
    await evaluationDays.recordDay({ projectId: "project-1", day: "2026-10-01" });

    await service.usageChanged({ projectId: "project-1" });

    expect(sent[0]?.[0]).toMatchObject({ traits: { has_habit: false } });
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
  it("sends signup-day traits from the organization's creation copy", async () => {
    const { service, traceDays, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      createdAt: new Map([["org-1", NOW - 3 * DAY_MS]]),
    });
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-20" });

    await service.usageChanged({ projectId: "project-1" });

    expect(traitsOf(sent[0]?.[0])).toMatchObject({ back_since_day_0: true });
  });

  /** @scenario "An organization nurturing never saw created gets no group call and no member identify" */
  it("sends no group call and no member identify for an organization without a creation copy", async () => {
    const { service, projectUsage, traceDays, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
      createdAt: new Map(),
      members: await membersOver(new Map([["user-1", ["org-1"]]])),
    });
    await projectUsage
      .forOwner("prompt")
      .store(usageOf("project-1", ["p1"]), storeContext("project-1"));
    await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-20" });

    await service.usageChanged({ projectId: "project-1" });

    expect(sent).toEqual([]);
  });

  describe("given a placed organization with 3 members and 2 projects, created at a known time", () => {
    const createdAt = NOW - DAY_MS;

    /** @scenario "The usage sync adds the company traits to its group call only" */
    it("sends project_count and created_at on the group call, never to members", async () => {
      const { service, projectUsage, sent } = await serviceOver({
        placed: new Map([
          ["project-1", "org-1"],
          ["project-2", "org-1"],
        ]),
        createdAt: new Map([["org-1", createdAt]]),
        members: await membersOver(
          new Map([
            ["admin-1", ["org-1"]],
            ["member-2", ["org-1"]],
            ["member-3", ["org-1"]],
          ]),
        ),
      });
      await projectUsage
        .forOwner("prompt")
        .store(usageOf("project-1", ["p1"]), storeContext("project-1"));

      await service.usageChanged({ projectId: "project-1" });

      const [group, identifies] = sent;
      expect(traitsOf(group?.[0])).toMatchObject({
        project_count: 2,
        created_at: Math.floor(createdAt / 1000),
        prompt_count: 1,
      });
      expect(identifies).toHaveLength(3);
      for (const identify of identifies ?? []) {
        for (const key of COMPANY_KEYS) expect(traitsOf(identify)).not.toHaveProperty(key);
      }
    });
  });

  describe("given a project of an organization nurturing never saw created", () => {
    /** @scenario "An organization nurturing never placed still sends nothing" */
    it("sends no group call and counts the sync not_placed", async () => {
      const observed = runObserved();
      const { service, sent } = await serviceOver({
        placed: new Map([["project-1", "org-1"]]),
        createdAt: new Map(),
        syncs: observed.syncs,
      });

      await service.usageChanged({ projectId: "project-1" });

      expect(sent).toEqual([]);
      expect(observed.outcomes).toEqual([{ outcome: "not_placed" }]);
    });
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
        { type: "identify", userId: "admin-1", traits: memberTraitsOf(group?.[0]) },
        { type: "identify", userId: "member-2", traits: memberTraitsOf(group?.[0]) },
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
      lines.length = 0;
      const { service, sent } = await serviceOver({
        placed,
        members: await membersOver(new Map([["admin-1", ["org-1"]]])),
        send: async (calls) => {
          if (calls.some((call) => call.type === "identify")) throw new Error("refused");
        },
      });

      await expect(service.usageChanged({ projectId: "project-1" })).resolves.toBeUndefined();

      expect(sent.map((calls) => calls.map((call) => call.type))).toEqual([["group"]]);
      const warned = lines.filter((line) => line.level === 40);
      expect(warned).toHaveLength(1);
      expect(warned[0]).toMatchObject({ organizationId: "org-1", msg: expect.any(String) });
    });

    /** @scenario "A failed member read fails the sync" */
    it("rejects when the members read fails, so the job retries", async () => {
      const { service } = await serviceOver({
        placed,
        members: {
          findMembershipsOfMembers: () => Promise.reject(new Error("member copy unavailable")),
        },
      });

      await expect(service.usageChanged({ projectId: "project-1" })).rejects.toThrow(
        "member copy unavailable",
      );
    });

    /** @scenario "A failed member read fails the sync" */
    it("sends the events on the retry once the members read is healthy again", async () => {
      const healthy = await membersOver(new Map([["admin-1", ["org-1"]]]));
      let failing = true;
      const { service, traceDays, sent } = await serviceOver({
        placed,
        createdAt: new Map([["org-1", NOW - 13 * DAY_MS]]),
        members: {
          findMembershipsOfMembers: (...args) =>
            failing
              ? Promise.reject(new Error("member copy unavailable"))
              : healthy.findMembershipsOfMembers(...args),
        },
      });
      await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-20" });

      await expect(service.tracesChanged({ projectId: "project-1" })).rejects.toThrow(
        "member copy unavailable",
      );
      failing = false;
      await service.tracesChanged({ projectId: "project-1" });

      const tracked = sent.flat().filter((call) => call.type === "track");
      expect(tracked.map((call) => call.messageId)).toEqual([
        "trace_active_day:admin-1:2026-11-20",
      ]);
    });
  });

  /** @scenario "An organization past its counting window gets no trace trait" */
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

  describe("when a project traces", () => {
    /** @scenario "A trace past the organization's counting window syncs nothing" */
    it("syncs its organization while inside the counting window", async () => {
      const { service, traceDays, sent } = await serviceOver({
        placed: new Map([["project-1", "org-1"]]),
      });
      await seedTraceDay(traceDays, { projectId: "project-1", day: "2026-11-19" });

      await service.tracesChanged({ projectId: "project-1" });

      expect(traitsOf(sent[0]?.[0])).toMatchObject({ trace_count: 1 });
    });

    /** @scenario "A trace past the organization's counting window syncs nothing" */
    it.each([
      [
        "an organization past its counting window",
        new Map([["project-1", "org-1"]]),
        NOW - 25 * DAY_MS,
      ],
      ["an organization never seen created", new Map([["project-1", "org-unknown"]]), NOW - DAY_MS],
      ["a project never seen created", new Map<string, string>(), NOW - DAY_MS],
    ])("sends nothing for %s", async (_name, placed, createdAt) => {
      const { service, sent } = await serviceOver({
        placed,
        createdAt: new Map([["org-1", createdAt]]),
      });

      await service.tracesChanged({ projectId: "project-1" });

      expect(sent).toEqual([]);
    });
  });

  describe("when a sync run is logged", () => {
    const placed = new Map([["project-1", "org-1"]]);

    /** @scenario "Each usage sync run is logged with counts, never ids" */
    it("logs a sent run once with its counts, and counts it as synced", async () => {
      const observed = runObserved();
      const { service } = await serviceOver({
        placed,
        logger: observed.logger,
        syncs: observed.syncs,
        members: await membersOver(
          new Map([
            ["admin-1", ["org-1"]],
            ["member-2", ["org-1"]],
          ]),
        ),
      });

      await service.usageChanged({ projectId: "project-1" });

      expect(observed.outcomes).toEqual([{ outcome: "synced" }]);
      expect(observed.at(INFO)).toEqual([]);
      expect(observed.at(DEBUG)).toEqual([
        expect.objectContaining({
          msg: "nurturing organization usage synced",
          counting: true,
          projects: 1,
          groupCalls: 1,
          identifyCalls: 2,
          members: 2,
          mirrorFailed: false,
        }),
      ]);
    });

    /** @scenario "Each usage sync run is logged with counts, never ids" */
    it("logs the debug skip with its reason when the organization has no admin, and sends nothing", async () => {
      const observed = runObserved();
      const { service, sent } = await serviceOver({
        syncs: observed.syncs,
        placed: new Map([["project-8", "org-without-admin"]]),
        createdAt: new Map([["org-without-admin", NOW - DAY_MS]]),
        logger: observed.logger,
      });

      await service.usageChanged({ projectId: "project-8" });

      expect(sent).toEqual([]);
      expect(observed.outcomes).toEqual([{ outcome: "no_admin" }]);
      expect(observed.at(DEBUG)).toEqual([
        expect.objectContaining({
          msg: "nurturing organization usage sync skipped",
          reason: "no_admin",
        }),
      ]);
      expect(observed.at(INFO)).toEqual([]);
    });

    /** @scenario "Each usage sync run is logged with counts, never ids" */
    it("logs a mirror failure on the synced line, and counts it as mirror_failed", async () => {
      const observed = runObserved();
      const { service } = await serviceOver({
        placed,
        logger: observed.logger,
        syncs: observed.syncs,
        members: await membersOver(new Map([["admin-1", ["org-1"]]])),
        send: async (calls) => {
          if (calls.some((call) => call.type === "identify")) throw new Error("refused");
        },
      });

      await service.usageChanged({ projectId: "project-1" });

      expect(observed.outcomes).toEqual([{ outcome: "mirror_failed" }]);
      // The one line that debugs a failure keeps the organization id.
      expect(observed.at(WARN)).toEqual([expect.objectContaining({ organizationId: "org-1" })]);
      expect(observed.at(DEBUG)).toEqual([
        expect.objectContaining({
          msg: "nurturing organization usage synced",
          mirrorFailed: true,
          groupCalls: 1,
          identifyCalls: 0,
        }),
      ]);
    });

    /** @scenario "Each usage sync run is logged with counts, never ids" */
    it("reports the identify calls sent before a later member batch failed", async () => {
      const observed = runObserved();
      let identifyBatches = 0;
      const { service } = await serviceOver({
        placed,
        logger: observed.logger,
        syncs: observed.syncs,
        members: await membersOver(
          new Map(Array.from({ length: 101 }, (_, index) => [`user-${index}`, ["org-1"]])),
        ),
        send: async (calls) => {
          if (calls.some((call) => call.type === "identify")) {
            identifyBatches += 1;
            if (identifyBatches === 2) throw new Error("refused");
          }
        },
      });

      await service.usageChanged({ projectId: "project-1" });

      expect(observed.outcomes).toEqual([{ outcome: "mirror_failed" }]);
      expect(observed.at(DEBUG)).toEqual([
        expect.objectContaining({ mirrorFailed: true, members: 101, identifyCalls: 100 }),
      ]);
    });

    /** @scenario "Each usage sync run is logged with counts, never ids" */
    it("counts a refused group call as send_failed and still rejects, so the job retries", async () => {
      const observed = runObserved();
      const { service } = await serviceOver({
        placed,
        logger: observed.logger,
        syncs: observed.syncs,
        send: async () => {
          throw new Error("Customer.io unavailable");
        },
      });

      await expect(service.usageChanged({ projectId: "project-1" })).rejects.toThrow(
        "Customer.io unavailable",
      );

      expect(observed.outcomes).toEqual([{ outcome: "send_failed" }]);
      expect(observed.at(DEBUG)).toEqual([]);
    });

    /** @scenario "Each usage sync run is logged with counts, never ids" */
    it("counts a repository failure as error once and still rejects", async () => {
      const observed = runObserved();
      const { service } = await serviceOver({
        placed,
        logger: observed.logger,
        syncs: observed.syncs,
        milestonesFailure: new Error("database unavailable"),
      });

      await expect(service.usageChanged({ projectId: "project-1" })).rejects.toThrow(
        "database unavailable",
      );

      expect(observed.outcomes).toEqual([{ outcome: "error" }]);
    });

    /** @scenario "Each usage sync run is logged with counts, never ids" */
    it("counts an empty project id as a not_placed skip", async () => {
      const observed = runObserved();
      const { service } = await serviceOver({
        placed,
        logger: observed.logger,
        syncs: observed.syncs,
      });

      await service.usageChanged({ projectId: "" });

      expect(observed.outcomes).toEqual([{ outcome: "not_placed" }]);
      expect(observed.at(DEBUG)).toEqual([
        expect.objectContaining({
          msg: "nurturing organization usage sync skipped",
          reason: "not_placed",
        }),
      ]);
    });

    /** @scenario "Each usage sync run is logged with counts, never ids" */
    it.each([
      ["a project never seen created", new Map<string, string>(), NOW - DAY_MS, "not_placed"],
      [
        "an organization past its counting window",
        placed,
        NOW - 25 * DAY_MS,
        "outside_counting_window",
      ],
    ])("logs %s as a debug skip for a trace", async (_name, projects, createdAt, reason) => {
      const observed = runObserved();
      const { service } = await serviceOver({
        placed: projects,
        createdAt: new Map([["org-1", createdAt]]),
        logger: observed.logger,
        syncs: observed.syncs,
      });

      await service.tracesChanged({ projectId: "project-1" });

      expect(observed.outcomes).toEqual([{ outcome: reason }]);
      expect(observed.at(DEBUG)).toEqual([
        expect.objectContaining({ msg: "nurturing organization usage sync skipped", reason }),
      ]);
      expect(observed.at(INFO)).toEqual([]);
    });

    /** @scenario "Each usage sync run is logged with counts, never ids" */
    it("puts no organization, user or project id in the info and debug lines or the counter", async () => {
      const observed = runObserved();
      const { service } = await serviceOver({
        placed,
        // Past its counting window, so the sweep ends it after the sync has sent.
        createdAt: new Map([["org-1", NOW - TRACE_COUNTING_WINDOW_MS]]),
        logger: observed.logger,
        syncs: observed.syncs,
        members: await membersOver(
          new Map([
            ["admin-1", ["org-1"]],
            ["member-2", ["org-1"]],
          ]),
        ),
      });

      await service.usageChanged({ projectId: "project-1" });
      await service.traceWindowsEnded({ after: NOW - 60 * 60 * 1000, upTo: NOW });

      expect(observed.at(DEBUG)).not.toEqual([]);
      expect(observed.at(INFO)).toEqual([expect.objectContaining({ synced: 1, identifyCalls: 2 })]);
      expect(observed.payloadKeys().filter((key) => /id$/i.test(key))).toEqual([]);
      for (const id of ["org-1", "admin-1", "member-2", "project-1"]) {
        expect(observed.serialised()).not.toContain(id);
      }
    });
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

    /** @scenario "Each usage sync run is logged with counts, never ids" */
    it("logs one summary line with how many ended, synced and had no admin", async () => {
      const observed = runObserved();
      const { service } = await serviceOver({
        placed: new Map(),
        createdAt: new Map([
          ["org-1", ended],
          ["org-without-admin", ended],
        ]),
        members: await membersOver(new Map([["member-2", ["org-1"]]])),
        logger: observed.logger,
      });

      await service.traceWindowsEnded({ after: NOW - 60 * 60 * 1000, upTo: NOW });

      expect(observed.at(INFO)).toEqual([
        expect.objectContaining({
          msg: "nurturing trace windows ended",
          ended: 2,
          synced: 1,
          skippedNoAdmin: 1,
          groupCalls: 1,
          identifyCalls: 1,
        }),
      ]);
    });

    /** @scenario "The trace traits are removed once when an organization's window ends" */
    it("drops the organization's trace days", async () => {
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

    /** @scenario "Evaluation days are dropped once their organization's window has passed" */
    it("drops the organization's evaluation days", async () => {
      const { service, evaluationDays } = await serviceOver({
        placed: new Map([["project-1", "org-1"]]),
        createdAt: new Map([["org-1", ended]]),
      });
      await evaluationDays.recordDay({ projectId: "project-1", day: "2026-11-19" });

      await service.traceWindowsEnded({ after: NOW - 60 * 60 * 1000, upTo: NOW });

      await expect(
        evaluationDays.findForProjects({ projectIds: ["project-1"], afterDay: "" }),
      ).resolves.toEqual([]);
    });

    /** @scenario "The trace traits are removed once when an organization's window ends" */
    it("throws when a member's identify is refused, and the retried sweep sends the same nulls", async () => {
      let refuse = true;
      const { service, sent } = await serviceOver({
        placed: new Map(),
        createdAt: new Map([["org-1", ended]]),
        members: await membersOver(new Map([["member-2", ["org-1"]]])),
        send: async (calls) => {
          if (refuse && calls.some((call) => call.type === "identify")) throw new Error("refused");
        },
      });
      const sweep = { after: NOW - 60 * 60 * 1000, upTo: NOW };

      await expect(service.traceWindowsEnded(sweep)).rejects.toThrow("refused");
      refuse = false;
      await service.traceWindowsEnded(sweep);

      expect(sent.map((calls) => calls.map((call) => call.type))).toEqual([
        ["group"],
        ["group"],
        ["identify"],
      ]);
      expect(sent[1]).toEqual(sent[0]);
      expect(sent[2]).toEqual([
        { type: "identify", userId: "member-2", traits: traitsOf(sent[0]?.[0]) },
      ]);
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

describe("NurturingOrganizationUsageService given an organization that traced today and yesterday", () => {
  const placed = new Map([["project-1", "org-1"]]);
  // Signed up 2026-11-07: yesterday, 11-19, is signup day 12 and today, 11-20, day 13.
  const createdAt = new Map([["org-1", NOW - 13 * DAY_MS]]);
  const tracksOf = (sent: readonly CioBatchCall[][]) =>
    sent.flat().filter((call): call is TrackCall => call.type === "track");

  /** One project's organization with traces on 11-10, yesterday and today. */
  async function tracedOrganization({
    members = new Map([["admin-1", ["org-1"]]]),
    ...rest
  }: Omit<Parameters<typeof serviceOver>[0], "placed" | "members"> & {
    members?: Memberships;
  } = {}) {
    const over = await serviceOver({
      placed,
      createdAt,
      ...rest,
      members: await membersOver(members),
    });
    for (const day of ["2026-11-10", "2026-11-19", "2026-11-20"]) {
      await seedTraceDay(over.traceDays, { projectId: "project-1", day });
    }
    return over;
  }

  /** @scenario "Each member gets trace_active_day once per UTC day their organization traced" */
  it("tracks trace_active_day on each member for today and yesterday, after the identifies", async () => {
    const observed = runObserved();
    const { service, sent } = await tracedOrganization({
      members: new Map([
        ["admin-1", ["org-1"]],
        ["member-2", ["org-1"]],
      ]),
      logger: observed.logger,
    });

    await service.tracesChanged({ projectId: "project-1" });

    expect(sent.map((calls) => calls[0]?.type)).toEqual(["group", "identify", "track"]);
    expect(tracksOf(sent)).toEqual(
      [
        ["admin-1", "2026-11-19", 12],
        ["admin-1", "2026-11-20", 13],
        ["member-2", "2026-11-19", 12],
        ["member-2", "2026-11-20", 13],
      ].map(([userId, date, daysSinceSignup]) => ({
        type: "track",
        userId,
        event: "trace_active_day",
        messageId: `trace_active_day:${userId}:${date}`,
        properties: { date, days_since_signup: daysSinceSignup },
      })),
    );
    expect(observed.at(DEBUG)).toEqual([expect.objectContaining({ trackCalls: 4 })]);
  });

  /** @scenario "Each member gets trace_active_day once per UTC day their organization traced" */
  it("keeps sending the active_day traits beside the event", async () => {
    const { service, sent } = await tracedOrganization();

    await service.tracesChanged({ projectId: "project-1" });

    expect(traitsOf(sent[0]?.[0])).toMatchObject({ active_day_12: true, active_day_13: true });
  });

  /** @scenario "trace_active_day is never sent twice for a member and day" */
  it("never sends it twice for a member and day, however often the organization syncs", async () => {
    const { service, sent } = await tracedOrganization();

    await service.tracesChanged({ projectId: "project-1" });
    await service.tracesChanged({ projectId: "project-1" });
    await service.usageChanged({ projectId: "project-1" });

    expect(tracksOf(sent).map((call) => call.messageId)).toEqual([
      "trace_active_day:admin-1:2026-11-19",
      "trace_active_day:admin-1:2026-11-20",
    ]);
  });

  /** @scenario "A member who joined another organization since does not get this one's traits" */
  it("tracks it only on the members the traits are mirrored onto", async () => {
    const { service, sent } = await tracedOrganization({
      members: new Map([
        ["admin-1", ["org-1"]],
        ["member-2", ["org-2", "org-1"]],
      ]),
    });

    await service.tracesChanged({ projectId: "project-1" });

    expect(new Set(tracksOf(sent).map((call) => call.userId))).toEqual(new Set(["admin-1"]));
  });

  /** @scenario "An organization past its counting window gets no trace_active_day" */
  it("tracks none for an organization past its counting window", async () => {
    const { service, sent } = await tracedOrganization({
      createdAt: new Map([["org-1", NOW - 25 * DAY_MS]]),
    });

    await service.usageChanged({ projectId: "project-1" });

    expect(tracksOf(sent)).toEqual([]);
  });

  /** @scenario "A failed trace_active_day send fails the sync, and its retry sends the events once" */
  it("rejects when the events are refused once, gives their claims back, and the retry sends each once", async () => {
    let refusals = 1;
    const observed = runObserved();
    const claims = MemoryNurturingClaimRepository.create();
    const { service, sent } = await tracedOrganization({
      claims,
      syncs: observed.syncs,
      logger: observed.logger,
      send: async (calls) => {
        if (refusals > 0 && calls.some((call) => call.type === "track")) {
          refusals -= 1;
          throw new Error("refused");
        }
      },
    });

    await expect(service.tracesChanged({ projectId: "project-1" })).rejects.toThrow("refused");
    expect(tracksOf(sent)).toEqual([]);
    expect(observed.outcomes).toEqual([{ outcome: "events_failed" }]);
    const releasedKey = "nurturing:trace_active_day:admin-1:2026-11-19";
    await expect(claims.claim(releasedKey, 60)).resolves.toBe(true);
    await claims.release(releasedKey);

    // The job's retry runs the same sync again, then a later sync of the day.
    await service.tracesChanged({ projectId: "project-1" });
    await service.tracesChanged({ projectId: "project-1" });

    expect(observed.outcomes).toEqual([
      { outcome: "events_failed" },
      { outcome: "synced" },
      { outcome: "synced" },
    ]);
    expect(tracksOf(sent).map((call) => call.messageId)).toEqual([
      "trace_active_day:admin-1:2026-11-19",
      "trace_active_day:admin-1:2026-11-20",
    ]);
  });

  /** @scenario "A failed trace_active_day send fails the sync, and its retry sends the events once" */
  it("gives back the claims already taken when another claim fails, and the retry sends them", async () => {
    const memory = MemoryNurturingClaimRepository.create();
    let failing = true;
    const claims: NurturingClaimRepository = {
      claim: async (key, ttlSeconds) => {
        if (failing && key.endsWith(":2026-11-20")) throw new Error("claims unavailable");
        return memory.claim(key, ttlSeconds);
      },
      release: (key) => memory.release(key),
    };
    const { service, sent } = await tracedOrganization({ claims });

    await expect(service.tracesChanged({ projectId: "project-1" })).rejects.toThrow(
      "claims unavailable",
    );
    expect(tracksOf(sent)).toEqual([]);

    failing = false;
    await service.tracesChanged({ projectId: "project-1" });

    expect(tracksOf(sent).map((call) => call.messageId)).toEqual([
      "trace_active_day:admin-1:2026-11-19",
      "trace_active_day:admin-1:2026-11-20",
    ]);
  });

  /** @scenario "A failed trace_active_day send fails the sync, and its retry sends the events once" */
  it("keeps a claim another sync holds when the send fails, and gives back the others", async () => {
    const claims = MemoryNurturingClaimRepository.create();
    const heldKey = "nurturing:trace_active_day:admin-1:2026-11-19";
    await claims.claim(heldKey, 60);
    const { service } = await tracedOrganization({
      claims,
      send: async (calls) => {
        if (calls.some((call) => call.type === "track")) throw new Error("refused");
      },
    });

    await expect(service.tracesChanged({ projectId: "project-1" })).rejects.toThrow("refused");

    await expect(claims.claim(heldKey, 60)).resolves.toBe(false);
    await expect(claims.claim("nurturing:trace_active_day:admin-1:2026-11-20", 60)).resolves.toBe(
      true,
    );
  });

  /** @scenario "A failed trace_active_day send fails the sync, and its retry sends the events once" */
  it("gives back a claim that was saved though its call rejected, so the retry sends it", async () => {
    const memory = MemoryNurturingClaimRepository.create();
    let failing = true;
    const claims: NurturingClaimRepository = {
      claim: async (key, ttlSeconds) => {
        const claimed = await memory.claim(key, ttlSeconds);
        if (failing && key.endsWith(":2026-11-20")) throw new Error("claim timed out");
        return claimed;
      },
      release: (key) => memory.release(key),
    };
    const { service, sent } = await tracedOrganization({ claims });

    await expect(service.tracesChanged({ projectId: "project-1" })).rejects.toThrow(
      "claim timed out",
    );

    failing = false;
    await service.tracesChanged({ projectId: "project-1" });

    expect(tracksOf(sent).map((call) => call.messageId)).toEqual([
      "trace_active_day:admin-1:2026-11-19",
      "trace_active_day:admin-1:2026-11-20",
    ]);
  });

  /** @scenario "A refused identify does not hold back trace_active_day" */
  it("still tracks trace_active_day on each member when their identify is refused", async () => {
    const observed = runObserved();
    const { service, sent } = await tracedOrganization({
      members: new Map([
        ["admin-1", ["org-1"]],
        ["member-2", ["org-1"]],
      ]),
      syncs: observed.syncs,
      logger: observed.logger,
      send: async (calls) => {
        if (calls.some((call) => call.type === "identify")) throw new Error("refused");
      },
    });

    await expect(service.tracesChanged({ projectId: "project-1" })).resolves.toBeUndefined();

    expect(observed.outcomes).toEqual([{ outcome: "mirror_failed" }]);
    expect(observed.at(WARN)).toHaveLength(1);
    expect(tracksOf(sent).map((call) => call.messageId)).toEqual([
      "trace_active_day:admin-1:2026-11-19",
      "trace_active_day:admin-1:2026-11-20",
      "trace_active_day:member-2:2026-11-19",
      "trace_active_day:member-2:2026-11-20",
    ]);
  });
});
