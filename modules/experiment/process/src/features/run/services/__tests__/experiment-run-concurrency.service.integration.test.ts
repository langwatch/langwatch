import { createTestLogger } from "@langwatch/test-harness";
/**
 * @vitest-environment node
 * @see modules/experiment/specs/experiment-run-dynamic-concurrency.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ExperimentRunActivityRepository } from "../../../../repositories/experiment-run-activity.repository.ts";
import { MemoryExperimentRunActivityRepository } from "../../../../repositories/memory/memory.experiment-run-activity.repository.ts";
import { RedisExperimentRunActivityRepository } from "../../../../repositories/redis/redis.experiment-run-activity.repository.ts";
import { EXPERIMENT_RUN_ACTIVITY_WINDOW_MS } from "../../rules/experiment-run-concurrency.rules.ts";
import { ExperimentRunConcurrencyService } from "../experiment-run-concurrency.service.ts";

const NOW = 1_800_000_000_000;
const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;

/** The service's behaviour over one store, run against the memory twin and real Redis. */
function behavesOver(
  store: () => { activity: ExperimentRunActivityRepository; projectId: string },
) {
  const serviceOver = ({
    activity,
    projectCellBudget,
  }: {
    activity: ExperimentRunActivityRepository;
    projectCellBudget?: number;
  }) =>
    ExperimentRunConcurrencyService.create({
      activity,
      config: {
        runConcurrency: 7,
        ...(projectCellBudget !== undefined ? { projectCellBudget } : {}),
      },
      now: () => NOW,
    });

  describe("when a run names a concurrency", () => {
    /** @scenario "A concurrency named by the request wins over the dynamic default" */
    it("answers the named concurrency", async () => {
      const { activity, projectId } = store();
      const service = serviceOver({ activity, projectCellBudget: 20 });

      expect(await service.resolve({ projectId, requested: 3 })).toBe(3);
    });
  });

  describe("when no project budget is set", () => {
    /** @scenario "Dynamic mode off keeps the fixed default" */
    it("answers EVAL_V3_CONCURRENCY whatever is active", async () => {
      const { activity, projectId } = store();
      for (const runId of ["run-a", "run-b"]) {
        await activity.markActive({ projectId, runId, expiresAt: NOW + 60_000 });
      }
      const service = serviceOver({ activity });

      expect(await service.resolve({ projectId })).toBe(7);
    });
  });

  describe("when a run started longer ago than the activity window never completed", () => {
    /** @scenario "An expired activity entry stops counting" */
    it("answers the full budget", async () => {
      const { activity, projectId } = store();
      const service = serviceOver({ activity, projectCellBudget: 20 });
      await service.recordStarted({
        projectId,
        runId: "crashed-run",
        startedAt: NOW - EXPERIMENT_RUN_ACTIVITY_WINDOW_MS - 1,
      });

      expect(await service.resolve({ projectId })).toBe(20);
    });
  });

  describe("when a run started and then completed", () => {
    /** @scenario "A completed run stops counting" */
    it("counts it while active and not once completed", async () => {
      const { activity, projectId } = store();
      const service = serviceOver({ activity, projectCellBudget: 20 });
      await service.recordStarted({ projectId, runId: "done-run", startedAt: NOW });
      const whileActive = await service.resolve({ projectId });
      await service.recordCompleted({ projectId, runId: "done-run" });

      expect(whileActive).toBe(10);
      expect(await service.resolve({ projectId })).toBe(20);
    });
  });
}

describe("ExperimentRunConcurrencyService", () => {
  describe("given the memory twin", () => {
    let count = 0;
    behavesOver(() => ({
      activity: MemoryExperimentRunActivityRepository.create(),
      projectId: `project-${(count += 1)}`,
    }));

    describe("when the active runs cannot be read", () => {
      /** @scenario "A failed read of the active runs falls back to EVAL_V3_CONCURRENCY" */
      it("answers EVAL_V3_CONCURRENCY and logs a warning", async () => {
        const { logger, lines } = createTestLogger();
        const service = ExperimentRunConcurrencyService.create({
          activity: createApiFixture<ExperimentRunActivityRepository>(
            { countActive: () => Promise.reject(new Error("redis down")) },
            "activity",
          ),
          config: { runConcurrency: 7, projectCellBudget: 20 },
          logger,
        });

        expect(await service.resolve({ projectId: "project-down" })).toBe(7);
        expect(lines.findLine("warn", "could not be read")).toBeDefined();
      });
    });
  });

  describe.skipIf(!redisUrl)("given the test Redis", () => {
    let redis: Redis;
    const projects: string[] = [];

    beforeAll(() => {
      redis = new Redis(redisUrl!);
    });

    afterAll(async () => {
      const members = projects.map((projectId) => `eval_v3_active_runs:project:${projectId}`);
      if (members.length > 0) await redis.del(...members);
      for (const projectId of projects) {
        for (const member of await redis.zrange("eval_v3_active_runs:global", 0, -1)) {
          if (member.startsWith(`${projectId}:`))
            await redis.zrem("eval_v3_active_runs:global", member);
        }
      }
      await redis.quit();
    });

    behavesOver(() => {
      const projectId = `project-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      projects.push(projectId);
      return { activity: RedisExperimentRunActivityRepository.create({ redis }), projectId };
    });

    describe("given two replicas over one Redis", () => {
      /** @scenario "The active runs are shared through the deployment's Redis" */
      it("counts a run one replica marked active on the other", async () => {
        const projectId = `project-${Date.now()}-shared`;
        projects.push(projectId);
        const replicaA = RedisExperimentRunActivityRepository.create({ redis });
        const replicaB = RedisExperimentRunActivityRepository.create({ redis });
        const before = await replicaB.countActive({ projectId, now: NOW });

        await replicaA.markActive({ projectId, runId: "run-1", expiresAt: NOW + 60_000 });
        const after = await replicaB.countActive({ projectId, now: NOW });

        expect(after.project).toBe(1);
        expect(after.global).toBe(before.global + 1);
      });
    });
  });
});
