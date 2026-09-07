import { describe, expect, it } from "vitest";
import {
  type ExecutionJobData,
  ScenarioExecutionPool,
} from "../execution-pool";
import { VoiceConcurrencyGate } from "../voice-concurrency-gate";

function voiceJob(n: number, projectId = "proj-1"): ExecutionJobData {
  return {
    projectId,
    scenarioId: `scenario-${n}`,
    scenarioRunId: `run-${n}`,
    batchRunId: "batch-1",
    setId: "set-1",
    target: { type: "voice", referenceId: `agent-${n}` },
  };
}

describe("ScenarioExecutionPool with a voice concurrency cap", () => {
  describe("when 4 voice runs start at once with a cap of 2", () => {
    /** @scenario At most the concurrency cap of voice runs execute at once */
    it("runs 2 and queues 2, then admits a queued one as a slot frees", () => {
      // A generous global concurrency so ONLY the voice cap can block a run.
      const pool = new ScenarioExecutionPool({
        concurrency: 10,
        voiceGate: new VoiceConcurrencyGate({ max: 2 }),
      });
      const started: string[] = [];
      // Started children never resolve here — they represent live calls.
      pool.setSpawnFunction((job) => {
        started.push(job.scenarioRunId);
        return new Promise<void>(() => {});
      });

      for (let n = 1; n <= 4; n++) pool.submit(voiceJob(n));

      expect(started).toEqual(["run-1", "run-2"]);
      expect(pool.pendingCount).toBe(2);

      // One call finishes: its voice slot frees and a queued run takes it.
      pool.deregisterChild("run-1");

      expect(started).toEqual(["run-1", "run-2", "run-3"]);
      expect(pool.pendingCount).toBe(1);
    });
  });

  describe("when a text run is queued behind blocked voice runs", () => {
    it("does not let the voice cap starve the text run", () => {
      const pool = new ScenarioExecutionPool({
        concurrency: 10,
        voiceGate: new VoiceConcurrencyGate({ max: 1 }),
      });
      const started: string[] = [];
      pool.setSpawnFunction((job) => {
        started.push(job.scenarioRunId);
        return new Promise<void>(() => {});
      });

      pool.submit(voiceJob(1)); // starts, holds the only voice slot
      pool.submit(voiceJob(2)); // blocked by the voice cap → queued
      // A text run behind the blocked voice run must still start.
      pool.submit({
        ...voiceJob(3),
        target: { type: "http", referenceId: "http-agent" },
      });

      expect(started).toContain("run-1");
      expect(started).toContain("run-3");
      expect(started).not.toContain("run-2");
    });
  });
});
