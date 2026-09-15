/**
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it } from "vitest";
import {
  type ExecutionJobData,
  JobNotAcceptedByPoolError,
  ScenarioExecutionPool,
} from "./execution-pool.unit.test.ts";
import { isVoiceJob } from "../voice-worker-only";

function job({
  n,
  type,
}: {
  n: number;
  type: ExecutionJobData["target"]["type"];
}): ExecutionJobData {
  return {
    projectId: "proj-1",
    scenarioId: `scenario-${n}`,
    scenarioRunId: `run-${n}`,
    batchRunId: "batch-1",
    setId: "set-1",
    target: { type, referenceId: `ref-${n}` },
  };
}

describe("ScenarioExecutionPool with the voice-only admission filter", () => {
  describe("given a pool that accepts only voice jobs", () => {
    /** @scenario "A voice worker runs only voice jobs" */
    it("refuses a non-voice job so another pod runs it", () => {
      const pool = new ScenarioExecutionPool({
        concurrency: 10,
        acceptJob: isVoiceJob,
      });
      const started: string[] = [];
      pool.setSpawnFunction((j) => {
        started.push(j.scenarioRunId);
        return new Promise<void>(() => {});
      });

      expect(() => pool.submit(job({ n: 1, type: "http" }))).toThrow(
        JobNotAcceptedByPoolError,
      );
      expect(started).toEqual([]);
    });

    /** @scenario "A voice worker runs only voice jobs" */
    it("starts a voice job submitted to the same pool", () => {
      const pool = new ScenarioExecutionPool({
        concurrency: 10,
        acceptJob: isVoiceJob,
      });
      const started: string[] = [];
      pool.setSpawnFunction((j) => {
        started.push(j.scenarioRunId);
        return new Promise<void>(() => {});
      });

      pool.submit(job({ n: 2, type: "voice" }));
      expect(started).toEqual(["run-2"]);
    });
  });

  describe("given a pool with no admission filter", () => {
    it("runs every job type, unchanged", () => {
      const pool = new ScenarioExecutionPool({ concurrency: 10 });
      const started: string[] = [];
      pool.setSpawnFunction((j) => {
        started.push(j.scenarioRunId);
        return new Promise<void>(() => {});
      });

      pool.submit(job({ n: 1, type: "http" }));
      pool.submit(job({ n: 2, type: "voice" }));
      expect(started).toEqual(["run-1", "run-2"]);
    });
  });
});
