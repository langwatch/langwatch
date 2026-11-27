import {
  type ReplayEvent,
  ReplayService,
  projectionLaneReplayer,
  replayProjectionsOf,
  sealPipelineDefinition,
} from "@langwatch/eventing";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's trace days rebuilt at deploy: the real replay engine over a seeded trace log, the
 * module's own steps, memory repositories. Per-fact live delivery is the oracle.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { IDLE_REPLAY_CLAIMS_INDEX } from "@langwatch/eventing/testing";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { isMigrationStep } from "@langwatch/upgrade/step";
import { describe, expect, it, vi } from "vitest";

import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import {
  buildNurturingProjectUsagePipeline,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  NURTURING_TRACE_DAY_SPANS_PROJECTION_NAME,
} from "../nurturing-project-usage.pipeline.ts";
import { allNurturingOwnerStandIns } from "./nurturing-owner-stand-ins.test-helpers.ts";
import { NurturingSeededLog } from "./nurturing-seeded-log.test-helpers.ts";
import {
  foldLive,
  spanReceived,
  traceDayReplayStepsOver,
  traceFailed,
} from "./nurturing-trace-days.test-helpers.ts";

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 23, 12);
const PROJECTS = ["project-1", "project-2"];
const SPANS_LANE = `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_TRACE_DAY_SPANS_PROJECTION_NAME}`;

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
      claims: IDLE_REPLAY_CLAIMS_INDEX,
      eventSource: new NurturingSeededLog(events),
      redis: memoryRedisDouble({
        script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
      }),
    }),
    projections: replayProjectionsOf([
      ...allNurturingOwnerStandIns(),
      sealPipelineDefinition(pipeline),
    ]),
  });
  const steps = traceDayReplayStepsOver(replayer, { now: NOW });
  const run = async ({ dryRun = false }: { dryRun?: boolean } = {}) => {
    const reports = [];
    for (const step of steps) {
      if (!isMigrationStep(step)) throw new Error("a trace-day step is a migration step");
      reports.push(
        await step.run({
          log: { info: () => undefined, warn: () => undefined },
          checkpoint: { resumeFrom: null, save: async () => undefined },
          dryRun,
          signal: new AbortController().signal,
        }),
      );
    }
    return reports;
  };
  const days = () => repositories.traceDays.findForProjects({ projectIds: PROJECTS, afterDay: "" });
  return { sync, run, days };
}

/** What per-fact live delivery of the facts leaves: each fold's own key, apply and store. */
async function liveDays(facts: readonly ReplayEvent[]) {
  const twin = MemoryNurturingTraceDayRepository.create();
  await foldLive({
    spans: twin.forSource("spans"),
    failures: twin.forSource("failures"),
    facts,
  });
  return twin.findForProjects({ projectIds: PROJECTS, afterDay: "" });
}

const byRow = (
  days: readonly { projectId: string; day: string; traceCount: number; errorCount: number }[],
) =>
  days.toSorted((a, b) =>
    `${a.projectId}:${a.day}:${a.traceCount}:${a.errorCount}`.localeCompare(
      `${b.projectId}:${b.day}:${b.traceCount}:${b.errorCount}`,
    ),
  );

describe("given trace's logs hold spans and failures from before the folds existed", () => {
  const facts = () => [
    spanReceived({ id: "root-1", createdAt: NOW - 50 * HOUR_MS }),
    spanReceived({
      id: "child-1",
      traceId: "root-1",
      parentSpanId: "root-1-span",
      createdAt: NOW - 50 * HOUR_MS,
    }),
    spanReceived({ id: "root-2", createdAt: NOW - 49 * HOUR_MS }),
    spanReceived({ id: "sample-1", createdAt: NOW - 49 * HOUR_MS, origin: "sample" }),
    spanReceived({ id: "langy-1", createdAt: NOW - 30 * HOUR_MS, origin: "langy" }),
    spanReceived({ id: "root-3", projectId: "project-2", createdAt: NOW - 2 * HOUR_MS }),
    traceFailed({ id: "root-2", createdAt: NOW - 48 * HOUR_MS }),
    traceFailed({ id: "langy-1", createdAt: NOW - 30 * HOUR_MS, origin: "langy" }),
  ];

  /** @scenario "The deploy replay rebuilds the trace days as live delivery wrote them" */
  it("rebuilds each project's day rows equal to the rows live delivery wrote", async () => {
    const seeded = facts();
    const worker = deploy({ events: seeded });

    await worker.run();

    const replayed = await worker.days();
    expect(byRow(replayed)).toEqual(byRow(await liveDays(seeded)));
    expect(byRow(replayed)).toEqual([
      expect.objectContaining({ projectId: "project-1", traceCount: 0, errorCount: 1 }),
      expect.objectContaining({ projectId: "project-1", traceCount: 2, errorCount: 0 }),
      expect.objectContaining({ projectId: "project-2", traceCount: 1, errorCount: 0 }),
    ]);
  });

  /** @scenario "The deploy replay rebuilds the trace days as live delivery wrote them" */
  it("leaves every row as it was when the steps run again", async () => {
    const worker = deploy({ events: facts() });
    await worker.run();
    const first = JSON.stringify(byRow(await worker.days()));

    await worker.run();

    expect(JSON.stringify(byRow(await worker.days()))).toBe(first);
  });

  /** @scenario "A deploy replay sends nothing to Customer.io or PostHog" */
  it("calls no sync or creation hook, so nothing is sent", async () => {
    const worker = deploy({ events: facts() });

    await worker.run();

    for (const hook of Object.values(worker.sync)) expect(hook).not.toHaveBeenCalled();
  });
});

describe("given a deployment with no Customer.io channel", () => {
  /** @scenario "Without a Customer.io channel nothing is counted, but the copies are kept" */
  it("replays the lanes under their own names and keeps no day", async () => {
    const worker = deploy({
      events: [spanReceived({ id: "root-1", createdAt: NOW - HOUR_MS })],
      syncs: false,
    });

    const [spans] = await worker.run({ dryRun: true });
    expect(spans).toMatchObject({ lane: SPANS_LANE });
    await worker.run();

    await expect(worker.days()).resolves.toEqual([]);
  });
});
