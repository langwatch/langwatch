import type { ProcessMembers } from "@langwatch/process-stores/members";
/**
 * @vitest-environment node
 * The run's folds and stop signal every replica shares through the deployment's Redis.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { ExperimentRunProgressState } from "../../experiment-run-fold.repository.ts";
import { RedisExperimentRunAbortRepository } from "../redis.experiment-run-abort.repository.ts";
import { RedisExperimentRunFoldRepository } from "../redis.experiment-run-fold.repository.ts";

/** The three Redis commands the run's folds and stop signal use, over one map. */
function redisKeys(): ProcessMembers["redis"] {
  const keys = new Map<string, string>();
  return createApiFixture<ProcessMembers["redis"]>(
    {
      get: async (key: unknown) => keys.get(String(key)) ?? null,
      set: async (...args: unknown[]) => {
        keys.set(String(args[0]), String(args[1]));
        return "OK";
      },
      del: async (...args: unknown[]) => (keys.delete(String(args[0])) ? 1 : 0),
    },
    "redis",
  );
}

const running: ExperimentRunProgressState = {
  projectId: "project_1",
  runId: "run_1",
  experimentId: "experiment_1",
  experimentSlug: "checkout-eval",
  status: "running",
  progress: 0,
  total: 2,
  startedAt: 1,
  recentEvents: [],
  seq: 1,
  failed: 0,
  persistResults: false,
  resultFrames: {},
  planned: true,
  phaseOneCells: 2,
  evaluators: {},
  finishedCells: "",
  targetOutputs: {},
  traceIds: {},
  evaluatorScores: {},
  CreatedAt: 0,
  UpdatedAt: 0,
  LastEventOccurredAt: 0,
};

describe("the run's Redis repositories", () => {
  describe("given two replicas over one Redis", () => {
    /** @scenario "A run's stop signal is shared through the deployment's Redis" */
    it("records a stop request where every replica reads it", async () => {
      const redis = redisKeys();
      const api = RedisExperimentRunAbortRepository.create({ redis });
      const worker = RedisExperimentRunAbortRepository.create({ redis });

      await api.requestAbort("run_1");

      await expect(worker.isAborted("run_1")).resolves.toBe(true);
      await expect(worker.isAborted("run_2")).resolves.toBe(false);
    });

    /** @scenario "Run progress is derived from the deployment's own Redis" */
    it("reads a run's progress another replica folded", async () => {
      const redis = redisKeys();
      const worker = RedisExperimentRunFoldRepository.create({ redis });
      const api = RedisExperimentRunFoldRepository.create({ redis });

      await worker.writeProgress({ state: running });

      await expect(api.readRunProgress({ runId: "run_1" })).resolves.toEqual({
        kind: "folded",
        state: running,
      });
    });
  });
});
