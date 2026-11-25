// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's evaluation days as a peer map filled at deploy: the real replay engine over a seeded
 * evaluation log, the module's own step, memory repositories. Per-fact live delivery is the oracle.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import {
  EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_LIFECYCLE_EVENT_VERSION,
  evaluationLifecycleCompletedEventDataSchema,
} from "@langwatch/evaluation-contract";
import {
  createTenantId,
  type ReplayEvent,
  ReplayService,
  projectionLaneReplayer,
  replayProjectionsOf,
  sealPipelineDefinition,
} from "@langwatch/eventing";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { isMigrationStep } from "@langwatch/upgrade/step";
import { describe, expect, it, vi } from "vitest";

import { MemoryNurturingEvaluationDayRepository } from "../../repositories/memory/memory.nurturing-evaluation-day.repository.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { utcDayOf } from "../../rules/nurturing-time.rules.ts";
import {
  buildNurturingProjectUsagePipeline,
  NURTURING_EVALUATION_DAYS_PROJECTION_NAME,
  NURTURING_EVALUATION_DAYS_REPLAY_SINCE,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  nurturingEvaluationDaysMap,
} from "../nurturing-project-usage.pipeline.ts";
import { allNurturingOwnerStandIns } from "./nurturing-owner-stand-ins.test-helpers.ts";
import {
  EVALUATION_DAYS_STEP,
  nurturingReplayStepsOver,
} from "./nurturing-replay-steps.test-helpers.ts";
import { NurturingSeededLog } from "./nurturing-seeded-log.test-helpers.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The earliest this release can ship: the step's fixed instant is 31 days before it. */
const RELEASE_MS = Date.UTC(2026, 10, 19);
const LANE = `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_EVALUATION_DAYS_PROJECTION_NAME}`;

let sequence = 0;
/** Evaluation's settled fact for `projectId` at `at`, as its log holds it. */
function evaluated(projectId: string, at: number): ReplayEvent {
  const n = ++sequence;
  return {
    id: `evaluation-${n}`,
    aggregateId: `evaluation-${n}`,
    aggregateType: EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
    tenantId: projectId,
    createdAt: at,
    timestamp: at,
    occurredAt: at,
    type: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
    version: EVALUATION_LIFECYCLE_EVENT_VERSION,
    idempotencyKey: `evaluation-${n}`,
    data: { tenantId: projectId, projectId, evaluationId: `evaluation-${n}`, occurredAt: at },
  };
}

/** The usage sync's hooks, each counting its calls: a replay must make none. */
function countingSync() {
  return {
    usageChanged: vi.fn(async () => undefined),
    tracesChanged: vi.fn(async () => undefined),
    organizationCreated: vi.fn(async () => undefined),
  };
}

/** A worker's deploy over the seeded log, with or without a Customer.io channel's sync. */
function deploy({ events, syncs = true }: { events: ReplayEvent[]; syncs?: boolean }) {
  const repositories = MemoryNurturingRepositories.create();
  const sync = countingSync();
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
      personalProjects: repositories.personalProjects,
      tracedProjects: repositories.tracedProjects,
      lastTraces: repositories.milestones,
    },
    plans: { store: repositories.plans, deliver: async () => undefined },
    sync: syncs ? sync : undefined,
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
  const step = nurturingReplayStepsOver(replayer).find(({ id }) => id === EVALUATION_DAYS_STEP);
  if (!step || !isMigrationStep(step)) throw new Error(`no step ${EVALUATION_DAYS_STEP}`);
  const run = ({ dryRun = false }: { dryRun?: boolean } = {}) =>
    step.run({
      log: { info: () => undefined, warn: () => undefined },
      checkpoint: { resumeFrom: null, save: async () => undefined },
      dryRun,
      signal: new AbortController().signal,
    });
  const days = (projectIds: string[]) =>
    repositories.evaluationDays.findForProjects({ projectIds, afterDay: "" });
  return { repositories, sync, run, days };
}

/** What per-fact live delivery of the facts leaves: the map's own mapping and write, one a fact. */
async function liveDays(facts: ReplayEvent[], projectIds: string[]) {
  const twin = MemoryNurturingEvaluationDayRepository.create();
  const { map } = nurturingEvaluationDaysMap(twin);
  for (const fact of facts) {
    const tenantId = createTenantId(fact.tenantId);
    const data = evaluationLifecycleCompletedEventDataSchema.parse(fact.data);
    const record = map.map({ ...fact, tenantId, data } as Parameters<typeof map.map>[0]);
    if (record) await map.store.append(record, { aggregateId: fact.aggregateId, tenantId });
  }
  return twin.findForProjects({ projectIds, afterDay: "" });
}

describe("given evaluation's log holds evaluations from before the map existed", () => {
  const facts = () => [
    evaluated("project-1", RELEASE_MS - 3 * DAY_MS),
    evaluated("project-1", RELEASE_MS - 3 * DAY_MS + 60_000),
    evaluated("project-1", RELEASE_MS - DAY_MS),
    evaluated("project-2", RELEASE_MS - 2 * DAY_MS),
  ];

  /** @scenario "The deploy replay fills the evaluation days as live delivery would" */
  it("fills each project's days as live delivery of the same facts would", async () => {
    const seeded = facts();
    const worker = deploy({ events: seeded });

    await worker.run();

    const projects = ["project-1", "project-2"];
    expect(await worker.days(projects)).toEqual(await liveDays(seeded, projects));
    expect((await worker.days(["project-1"])).map(({ day }) => day).toSorted()).toEqual([
      "2026-11-16",
      "2026-11-18",
    ]);
  });

  /** @scenario "The deploy replay fills the evaluation days as live delivery would" */
  it("leaves every row as it was when the step runs again", async () => {
    const worker = deploy({ events: facts() });
    await worker.run();
    const first = JSON.stringify(await worker.days(["project-1", "project-2"]));

    await worker.run();

    expect(JSON.stringify(await worker.days(["project-1", "project-2"]))).toBe(first);
  });

  /** @scenario "A deploy replay sends nothing to Customer.io or PostHog" */
  it("calls no sync, count or creation hook, so nothing is sent", async () => {
    const worker = deploy({ events: facts() });

    await worker.run();

    for (const hook of Object.values(worker.sync)) expect(hook).not.toHaveBeenCalled();
  });
});

describe("given the step's fixed starting instant", () => {
  /** @scenario "The deploy replay re-derives every day the migration copied" */
  it("replays a day at the far edge of the usage read at the earliest release", async () => {
    const edge = evaluated("project-3", RELEASE_MS - 30 * DAY_MS);
    const worker = deploy({ events: [edge] });

    await worker.run();

    await expect(worker.days(["project-3"])).resolves.toEqual([
      { projectId: "project-3", day: utcDayOf(RELEASE_MS - 30 * DAY_MS) },
    ]);
  });

  /** @scenario "The deploy replay re-derives every day the migration copied" */
  it("does not replay a fact older than its instant, which no usage read reaches", async () => {
    const before = evaluated("project-4", Date.parse(NURTURING_EVALUATION_DAYS_REPLAY_SINCE) - 1);
    const worker = deploy({ events: [before] });

    await worker.run();

    await expect(worker.days(["project-4"])).resolves.toEqual([]);
  });

  /** @scenario "The deploy replay re-derives every day the migration copied" */
  it("restores a day the migration copied when the copy row is gone", async () => {
    const copied = evaluated("project-5", RELEASE_MS - 10 * DAY_MS);
    const worker = deploy({ events: [copied] });
    const day = { projectId: "project-5", day: utcDayOf(RELEASE_MS - 10 * DAY_MS) };
    await worker.repositories.evaluationDays.recordDay(day);
    await worker.repositories.evaluationDays.pruneProjects({ projectIds: ["project-5"] });

    await worker.run();

    await expect(worker.days(["project-5"])).resolves.toEqual([day]);
  });
});

describe("given a deployment with no Customer.io channel", () => {
  /** @scenario "Without a Customer.io channel nothing is counted, but the copies are kept" */
  it("replays the lane under its own name and keeps no day, as nothing reads or prunes them", async () => {
    const worker = deploy({ events: [evaluated("project-6", RELEASE_MS - DAY_MS)], syncs: false });

    await expect(worker.run({ dryRun: true })).resolves.toMatchObject({ lane: LANE });
    await worker.run();

    await expect(worker.days(["project-6"])).resolves.toEqual([]);
  });
});
