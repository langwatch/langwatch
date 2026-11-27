// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's personal-project, traced-project and last-trace copies as peer maps filled at
 * deploy: the real replay engine over seeded owner logs, the module's own steps, memory
 * repositories. The per-fact memory twin is the oracle, and no channel is ever reachable.
 * Spec: enterprise/modules/nurturing/specs/project-facts-copies.feature
 */
import {
  type ReplayEvent,
  ReplayService,
  projectionLaneReplayer,
  replayProjectionsOf,
  sealPipelineDefinition,
} from "@langwatch/eventing";
import {
  PERSONAL_TEAM_CREATED_EVENT_TYPE,
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
} from "@langwatch/organization-contract";
import {
  PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE,
  PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE,
} from "@langwatch/project-contract";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  PROJECT_TRACED_EVENT_TYPE,
  TRACE_RECEIVED_EVENT_TYPE,
} from "@langwatch/trace-contract";
import { isMigrationStep, type MigrationStep } from "@langwatch/upgrade/step";
import {
  USER_AGGREGATE_TYPE,
  USER_ERASED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
} from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryCustomerIoChannel } from "../../channels/memory/memory.customer-io.channel.ts";
import { MemoryPostHogChannel } from "../../channels/memory/memory.posthog.channel.ts";
import type { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import type { MemoryNurturingPersonalProjectRepository } from "../../repositories/memory/memory.nurturing-personal-project.repository.ts";
import type { MemoryNurturingTracedProjectRepository } from "../../repositories/memory/memory.nurturing-traced-project.repository.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingPersonalProjectRepository } from "../../repositories/nurturing-personal-project.repository.ts";
import { buildNurturingProjectUsagePipeline } from "../nurturing-project-usage.pipeline.ts";
import { allNurturingOwnerStandIns } from "./nurturing-owner-stand-ins.test-helpers.ts";
import {
  LAST_TRACES_STEP,
  PERSONAL_OWNERS_OF_ORGANIZATION_STEP,
  PERSONAL_OWNERS_OF_PROJECT_STEP,
  projectCopiesReplayStepsOver,
  TRACED_PROJECTS_OF_PROJECT_STEP,
  TRACED_PROJECTS_OF_TRACE_STEP,
} from "./nurturing-project-copies.test-helpers.ts";
import {
  IDENTITY_MARKS_STEP,
  nurturingReplayStepsOver,
  USER_MARKS_STEP,
} from "./nurturing-replay-steps.test-helpers.ts";
import { NurturingSeededLog } from "./nurturing-seeded-log.test-helpers.ts";

/** After the release's replay window opens (the day before 2026-11-19). */
const AFTER_RELEASE_MS = Date.UTC(2026, 10, 19, 12);
/** Before it: such a trace time is already in the column, so the last-trace replay skips it. */
const BEFORE_RELEASE_MS = Date.UTC(2026, 9, 1);

let sequence = 0;
/** An owner's fact as its log holds it, in the order the test appends it. */
function ownerFact({
  type,
  aggregateType,
  aggregateId,
  tenantId,
  data,
  at = AFTER_RELEASE_MS,
}: {
  type: string;
  aggregateType: string;
  aggregateId: string;
  tenantId: string;
  data: Record<string, unknown>;
  at?: number;
}): ReplayEvent {
  const n = ++sequence;
  return {
    id: `fact-${n}`,
    aggregateId,
    aggregateType,
    tenantId,
    createdAt: at + n,
    timestamp: at + n,
    occurredAt: at,
    type,
    version: "2026-11-11",
    idempotencyKey: `fact-${n}`,
    data: { tenantId, occurredAt: at, ...data },
  };
}

const personalTeamCreated = (projectId: string, userId: string, organizationId = "org-1") =>
  ownerFact({
    type: PERSONAL_TEAM_CREATED_EVENT_TYPE,
    aggregateType: "organization",
    aggregateId: organizationId,
    tenantId: organizationId,
    data: {
      organizationId,
      userId,
      teamId: `team-${projectId}`,
      projectId,
      projectSlug: projectId,
    },
  });

const personalWorkspaceProvisioned = (
  projectId: string,
  userId: string,
  organizationId = "org-1",
) =>
  ownerFact({
    type: PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
    aggregateType: "organization",
    aggregateId: organizationId,
    tenantId: organizationId,
    data: { organizationId, userId, projectId },
  });

const personalOwnerListed = (projectId: string, ownerUserId: string, organizationId = "org-1") =>
  ownerFact({
    type: PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE,
    aggregateType: "project",
    aggregateId: projectId,
    tenantId: projectId,
    data: { projectId, organizationId, ownerUserId },
  });

const projectTraced = (projectId: string, organizationId: string | null) =>
  ownerFact({
    type: PROJECT_TRACED_EVENT_TYPE,
    aggregateType: "trace_project_milestone",
    aggregateId: projectId,
    tenantId: projectId,
    data: { projectId, organizationId },
  });

const firstMessageListed = (projectId: string, organizationId: string) =>
  ownerFact({
    type: PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE,
    aggregateType: "project",
    aggregateId: projectId,
    tenantId: projectId,
    data: { projectId, organizationId },
  });

const traceFact = ({
  type = TRACE_RECEIVED_EVENT_TYPE,
  projectId = "project-t1",
  organizationId,
  at,
}: {
  type?: string;
  projectId?: string;
  organizationId?: string;
  at: number;
}) =>
  ownerFact({
    type,
    aggregateType: "trace_project_milestone",
    aggregateId: projectId,
    tenantId: projectId,
    at,
    data: {
      projectId,
      userId: "admin-1",
      ...(type === FIRST_TRACE_RECORDED_EVENT_TYPE && { sdkLanguage: "python", sdkFramework: "x" }),
      ...(organizationId !== undefined && { organizationId }),
    },
  });

function userErased(userId: string): ReplayEvent {
  const n = ++sequence;
  return {
    id: `user-${n}`,
    aggregateId: userId,
    aggregateType: USER_AGGREGATE_TYPE,
    tenantId: userId,
    createdAt: AFTER_RELEASE_MS + n,
    timestamp: AFTER_RELEASE_MS + n,
    occurredAt: AFTER_RELEASE_MS + n,
    type: USER_ERASED_EVENT_TYPE,
    version: USER_LIFECYCLE_EVENT_VERSION,
    idempotencyKey: `user-${n}`,
    data: { tenantId: userId, userId, occurredAt: AFTER_RELEASE_MS + n },
  };
}

/** The same facts with their log order turned around: the last fact appended is the first. */
function inReverse(events: ReplayEvent[]): ReplayEvent[] {
  const stamps = events.map(({ timestamp }) => timestamp);
  const flip = Math.min(...stamps) + Math.max(...stamps);
  return events.map((event) => ({
    ...event,
    createdAt: flip - event.createdAt,
    timestamp: flip - event.timestamp,
  }));
}

/** What a channel would have been asked, were any reachable from the copies. */
function channels() {
  const customerIo = MemoryCustomerIoChannel.create();
  const calls = [
    vi.spyOn(customerIo, "identifyUser"),
    vi.spyOn(customerIo, "trackEvent"),
    vi.spyOn(customerIo, "groupUser"),
    vi.spyOn(customerIo, "batch"),
  ];
  const posthog = MemoryPostHogChannel.create();
  return {
    requests: () => ({
      customerIo: calls.reduce((sum, spy) => sum + spy.mock.calls.length, 0),
      posthog: posthog.tracked.length + posthog.identified.length,
    }),
  };
}

/** A worker's deploy over the seeded owner logs: nurturing's own steps and its memory copies. */
function deploy({
  events,
  personalProjects,
}: {
  events: ReplayEvent[];
  /** Wraps the owner copy the two lanes write, to interleave a write. */
  personalProjects?: (
    inner: NurturingPersonalProjectRepository,
  ) => NurturingPersonalProjectRepository;
}) {
  const repositories = MemoryNurturingRepositories.create();
  const warnings: Record<string, unknown>[] = [];
  const sinks = channels();
  const log = new NurturingSeededLog(events);
  const pipeline = buildNurturingProjectUsagePipeline({
    store: repositories.projectUsage,
    evaluationDays: repositories.evaluationDays,
    traceDays: repositories.traceDays,
    copies: {
      placements: repositories.placements,
      organizationsCreated: repositories.organizationsCreated,
      admins: repositories.milestones,
      members: repositories.members,
      virtualKeys: repositories.virtualKeys,
      personalProjects: personalProjects
        ? personalProjects(repositories.personalProjects)
        : repositories.personalProjects,
      tracedProjects: repositories.tracedProjects,
      lastTraces: repositories.milestones,
    },
    plans: { store: repositories.plans, deliver: async () => undefined },
    sync: undefined,
    logger: { warn: (payload) => void warnings.push(payload) },
  });
  const replayer = projectionLaneReplayer({
    service: new ReplayService({
      eventSource: log,
      redis: memoryRedisDouble({
        script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
      }),
    }),
    projections: replayProjectionsOf([
      ...allNurturingOwnerStandIns(),
      sealPipelineDefinition(pipeline),
    ]),
  });
  const steps = [...nurturingReplayStepsOver(replayer), ...projectCopiesReplayStepsOver(replayer)];
  const run = async (id: string) => {
    const step: MigrationStep | undefined = steps.find((each) => each.id === id);
    if (!step || !isMigrationStep(step)) throw new Error(`no step ${id}`);
    return step.run({
      log: { info: () => undefined, warn: () => undefined },
      checkpoint: { resumeFrom: null, save: async () => undefined },
      dryRun: false,
      signal: new AbortController().signal,
    });
  };
  /** Every step in the order the module declares them, as the upgrade runner orders them. */
  const runAll = async () => {
    for (const { id } of steps) await run(id);
  };
  /** The copies' rows, in the order each store keeps them; the memory twins list what they hold. */
  const state = async (organizationIds: string[] = []) => ({
    personal: (
      repositories.personalProjects as MemoryNurturingPersonalProjectRepository
    ).storedRows(),
    traced: (repositories.tracedProjects as MemoryNurturingTracedProjectRepository).storedRows(),
    lastTraceAt: await Promise.all(
      organizationIds.map((organizationId) =>
        (repositories.milestones as MemoryNurturingMilestonesRepository).findLastTraceAt({
          organizationId,
        }),
      ),
    ),
  });
  return { repositories, run, runAll, state, warnings, requests: sinks.requests };
}

const byProject = <Row extends { projectId: string }>(rows: Row[]) =>
  rows.toSorted((a, b) => a.projectId.localeCompare(b.projectId));

/** What per-fact live delivery of the owner facts leaves: the oracle's rows. */
async function perFact({
  personal = [],
  traced = [],
  traces = [],
  erased = [],
}: {
  personal?: { projectId: string; organizationId: string; ownerUserId: string }[];
  traced?: { projectId: string; organizationId: string }[];
  traces?: { organizationId: string; occurredAt: number }[];
  erased?: string[];
}) {
  const repositories = MemoryNurturingRepositories.create();
  for (const userId of erased) {
    await repositories.personalProjects.forgetOwner({ ownerUserId: userId });
  }
  for (const row of personal) await repositories.personalProjects.recordOwner(row);
  for (const row of traced) await repositories.tracedProjects.recordTraced(row);
  for (const trace of traces) await repositories.milestones.recordLastTrace(trace);
  return repositories;
}

describe("given organization's and project's logs hold personal projects from before the copy", () => {
  const facts = () => [
    personalTeamCreated("project-p1", "user-1"),
    personalWorkspaceProvisioned("project-p2", "user-2"),
    personalOwnerListed("project-p3", "user-3"),
    // The same project named by two owner facts keeps the first owner either way.
    personalTeamCreated("project-p4", "user-4"),
    personalOwnerListed("project-p4", "user-4"),
  ];
  const rows = [
    { projectId: "project-p1", organizationId: "org-1", ownerUserId: "user-1" },
    { projectId: "project-p2", organizationId: "org-1", ownerUserId: "user-2" },
    { projectId: "project-p3", organizationId: "org-1", ownerUserId: "user-3" },
    { projectId: "project-p4", organizationId: "org-1", ownerUserId: "user-4" },
  ];

  /** @scenario "Replaying the personal-owner lanes fills each owner row as live delivery would" */
  it("fills each owner as live delivery of the same facts would, and sends nothing", async () => {
    const worker = deploy({ events: facts() });

    await worker.runAll();

    const oracle = await perFact({ personal: rows });
    expect(byProject((await worker.state()).personal)).toEqual(
      (oracle.personalProjects as MemoryNurturingPersonalProjectRepository).storedRows(),
    );
    expect(worker.requests()).toEqual({ customerIo: 0, posthog: 0 });
  });

  /** @scenario "Replaying a copy twice leaves every row as it was" */
  it("leaves the rows byte-identical after a second run, trailing pass included", async () => {
    const worker = deploy({ events: facts() });
    await worker.runAll();
    const first = JSON.stringify(await worker.state());

    await worker.run(PERSONAL_OWNERS_OF_ORGANIZATION_STEP);
    await worker.run(PERSONAL_OWNERS_OF_PROJECT_STEP);

    expect(JSON.stringify(await worker.state())).toBe(first);
  });

  /** @scenario "A personal owner's facts delivered again or in reverse order leave the same row" */
  it("leaves the same rows when the owner facts are logged in reverse order", async () => {
    const forward = deploy({ events: facts() });
    const reversed = deploy({ events: inReverse(facts()) });

    await forward.runAll();
    await reversed.runAll();

    expect(byProject((await reversed.state()).personal)).toEqual(
      byProject((await forward.state()).personal),
    );
  });
});

describe("given people were erased before nurturing kept erasure marks", () => {
  const person = "user-erased-in-user-log";
  const logOf = (owner: ReplayEvent[]) => [...owner, userErased(person)];

  /** @scenario "A personal owner erased before the replay is on no owner row after it" */
  it("stores them on no owner row from either log, after the steps run in the declared order", async () => {
    const worker = deploy({
      events: logOf([
        personalTeamCreated("project-e1", person),
        personalOwnerListed("project-e2", person),
        personalTeamCreated("project-e3", "user-kept"),
      ]),
    });

    await worker.runAll();

    expect((await worker.state()).personal).toEqual([
      { projectId: "project-e3", organizationId: "org-1", ownerUserId: "user-kept" },
    ]);
  });

  /** @scenario "A personal owner erased before the replay is on no owner row after it" */
  it("would store them if the owner step ran before the marks, and the owner step run after them clears them", async () => {
    const worker = deploy({ events: logOf([personalTeamCreated("project-e1", person)]) });

    await worker.run(PERSONAL_OWNERS_OF_ORGANIZATION_STEP);
    expect((await worker.state()).personal).toHaveLength(1);
    await worker.run(USER_MARKS_STEP);
    await worker.run(IDENTITY_MARKS_STEP);
    await worker.run(PERSONAL_OWNERS_OF_ORGANIZATION_STEP);

    expect((await worker.state()).personal).toEqual([]);
  });

  /** @scenario "A personal owner erased during the replay is on no owner row after it" */
  it("leaves them on no row when their erasure lands between two replayed facts", async () => {
    const mid = "user-erased-mid-replay";
    const worker = deploy({
      events: [1, 2, 3].map((n) => personalTeamCreated(`project-m${n}`, mid)),
      personalProjects: (inner) => {
        let erasedOnce = false;
        return {
          findOwnerUserIds: (input) => inner.findOwnerUserIds(input),
          forgetOwner: (input) => inner.forgetOwner(input),
          recordOwner: async (input) => {
            await inner.recordOwner(input);
            if (erasedOnce) return;
            erasedOnce = true;
            await inner.forgetOwner({ ownerUserId: mid });
          },
        };
      },
    });

    await worker.runAll();

    expect((await worker.state()).personal).toEqual([]);
  });
});

describe("given trace's and project's logs hold traced projects from before the copy", () => {
  const facts = () => [
    projectTraced("project-a", "org-a"),
    projectTraced("project-a", "org-a"),
    projectTraced("project-n", null),
    firstMessageListed("project-a", "org-a"),
    firstMessageListed("project-b", "org-b"),
  ];

  /** @scenario "Replaying the traced-project lanes fills each traced row as live delivery would" */
  it("fills each traced row as live delivery would, logging the project with no organization", async () => {
    const worker = deploy({ events: facts() });

    await worker.runAll();

    const oracle = await perFact({
      traced: [
        { projectId: "project-a", organizationId: "org-a" },
        { projectId: "project-b", organizationId: "org-b" },
      ],
    });
    expect(byProject((await worker.state()).traced)).toEqual(
      (oracle.tracedProjects as MemoryNurturingTracedProjectRepository).storedRows(),
    );
    expect(worker.warnings.map(({ projectId }) => projectId)).toContain("project-n");
    expect(worker.requests()).toEqual({ customerIo: 0, posthog: 0 });
  });

  /** @scenario "A traced fact delivered again or in reverse order leaves the same rows" */
  it("leaves the same rows in reverse order and after a second run of both steps", async () => {
    const forward = deploy({ events: facts() });
    const reversed = deploy({ events: inReverse(facts()) });
    await forward.runAll();
    await reversed.runAll();
    const first = JSON.stringify(await forward.state());

    await forward.run(TRACED_PROJECTS_OF_TRACE_STEP);
    await forward.run(TRACED_PROJECTS_OF_PROJECT_STEP);

    expect(JSON.stringify(await forward.state())).toBe(first);
    expect(byProject((await reversed.state()).traced)).toEqual(
      byProject((await forward.state()).traced),
    );
  });
});

describe("given trace's log holds trace times from before and after the release", () => {
  const facts = () => [
    traceFact({
      type: FIRST_TRACE_RECORDED_EVENT_TYPE,
      organizationId: "org-1",
      at: AFTER_RELEASE_MS,
    }),
    traceFact({ organizationId: "org-1", at: AFTER_RELEASE_MS + 5_000 }),
    traceFact({ organizationId: "org-1", projectId: "project-t2", at: AFTER_RELEASE_MS + 2_000 }),
    traceFact({ organizationId: "org-2", projectId: "project-t3", at: AFTER_RELEASE_MS + 1_000 }),
    // Already in the column, so the replay window skips it; a fact naming no organization writes
    // nothing.
    traceFact({ organizationId: "org-old", projectId: "project-t4", at: BEFORE_RELEASE_MS }),
    traceFact({ projectId: "project-t5", at: AFTER_RELEASE_MS + 9_000 }),
  ];

  /** @scenario "Replaying the last-trace lane fills each organization's latest trace time" */
  it("fills each organization's latest time since the day before the release, and sends nothing", async () => {
    const worker = deploy({ events: facts() });

    await worker.runAll();

    expect((await worker.state(["org-1", "org-2", "org-old"])).lastTraceAt).toEqual([
      AFTER_RELEASE_MS + 5_000,
      AFTER_RELEASE_MS + 1_000,
      null,
    ]);
    expect(worker.requests()).toEqual({ customerIo: 0, posthog: 0 });
  });

  /** @scenario "Replaying the last-trace lane twice, or in reverse order, leaves each time as it was" */
  it("leaves the same times in reverse order and after a second run", async () => {
    const forward = deploy({ events: facts() });
    // The old fact stays out of the flip: flipped, it would stretch the range and push the rest below the replay window.
    const reversed = deploy({
      events: inReverse(facts().filter(({ timestamp }) => timestamp >= AFTER_RELEASE_MS)),
    });
    await forward.runAll();
    await reversed.runAll();
    const first = JSON.stringify(await forward.state(["org-1", "org-2"]));

    await forward.run(LAST_TRACES_STEP);

    expect(JSON.stringify(await forward.state(["org-1", "org-2"]))).toBe(first);
    expect(JSON.stringify(await reversed.state(["org-1", "org-2"]))).toBe(first);
  });
});
