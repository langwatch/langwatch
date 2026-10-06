import { SCENARIO_RESOURCE_CLASSES, TARGET_RESOURCE_CLASS } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  type ExecutionJobData,
  ScenarioExecutionPoolService,
} from "../services/scenario-execution-pool.service.ts";

const LIGHT = SCENARIO_RESOURCE_CLASSES.light.weight;
const VOICE = SCENARIO_RESOURCE_CLASSES.voice.weight;

function job({
  n,
  type,
  projectId = "proj-1",
}: {
  n: number;
  type: ExecutionJobData["target"]["type"];
  projectId?: string;
}): ExecutionJobData {
  return {
    projectId,
    scenarioId: `scenario-${n}`,
    scenarioRunId: `run-${n}`,
    batchRunId: "batch-1",
    setId: "set-1",
    target: { type, referenceId: `ref-${n}` },
  };
}

function poolOf({
  concurrency,
  projectSlots,
}: {
  concurrency: number;
  projectSlots?: { voice?: number };
}) {
  const started: string[] = [];
  const pool = ScenarioExecutionPoolService.create({ concurrency, projectSlots });
  pool.connect({
    execute: (running) => {
      started.push(running.scenarioRunId);
      return new Promise<void>(() => {});
    },
    skipCancelled: () => undefined,
  });
  return { pool, started };
}

describe("ScenarioExecutionPool weighted admission", () => {
  describe("given a budget of slots", () => {
    /** @scenario "Admission weighs each run by its runtime class" */
    it("weighs voice and light at one slot each, keeping today's run-count limit", () => {
      expect(VOICE).toBe(1);
      expect(LIGHT).toBe(1);
      expect(TARGET_RESOURCE_CLASS.voice).toBe("voice");
      expect(TARGET_RESOURCE_CLASS.http).toBe("light");
    });

    /** @scenario "Admission weighs each run by its runtime class" */
    it("charges a light run one slot and holds back what does not fit", () => {
      const { pool, started } = poolOf({ concurrency: 3 });

      for (let n = 1; n <= 4; n++) pool.submit(job({ n, type: "http" }));

      expect(started).toEqual(["run-1", "run-2", "run-3"]);
      expect(pool.pendingCount).toBe(1);
    });

    /** @scenario "Admission weighs each run by its runtime class" */
    it("charges a voice run its class weight, so it takes room from light runs", () => {
      const { pool, started } = poolOf({ concurrency: LIGHT * 2 + VOICE });

      pool.submit(job({ n: 1, type: "voice" }));
      pool.submit(job({ n: 2, type: "http" }));
      pool.submit(job({ n: 3, type: "http" }));
      pool.submit(job({ n: 4, type: "http" }));

      expect(started).toEqual(["run-1", "run-2", "run-3"]);
      expect(pool.pendingCount).toBe(1);
    });

    /** @scenario "Admission weighs each run by its runtime class" */
    it("admits every waiting run that now fits when a heavier run frees its slots", () => {
      const { pool, started } = poolOf({ concurrency: VOICE });
      pool.submit(job({ n: 1, type: "voice" }));
      for (let n = 2; n <= 1 + VOICE; n++) pool.submit(job({ n, type: "http" }));
      expect(started).toEqual(["run-1"]);

      pool.deregisterChild("run-1");

      expect(started).toHaveLength(1 + VOICE);
      expect(pool.pendingCount).toBe(0);
    });

    /** @scenario "Admission weighs each run by its runtime class" */
    it("lets a run heavier than the whole budget run alone", () => {
      const { pool, started } = poolOf({ concurrency: 0 });

      pool.submit(job({ n: 1, type: "voice" }));
      pool.submit(job({ n: 2, type: "http" }));

      expect(started).toEqual(["run-1"]);
      expect(pool.pendingCount).toBe(1);

      pool.deregisterChild("run-1");

      expect(started).toEqual(["run-1", "run-2"]);
    });

    /** @scenario "Admission weighs each run by its runtime class" */
    it("holds back only the project over its class budget", () => {
      const { pool, started } = poolOf({ concurrency: 100, projectSlots: { voice: VOICE } });

      pool.submit(job({ n: 1, type: "voice", projectId: "proj-a" }));
      pool.submit(job({ n: 2, type: "voice", projectId: "proj-a" }));
      pool.submit(job({ n: 3, type: "voice", projectId: "proj-b" }));
      pool.submit(job({ n: 4, type: "http", projectId: "proj-a" }));

      expect(started).toEqual(["run-1", "run-3", "run-4"]);
      expect(pool.pendingCount).toBe(1);
    });
  });
});
