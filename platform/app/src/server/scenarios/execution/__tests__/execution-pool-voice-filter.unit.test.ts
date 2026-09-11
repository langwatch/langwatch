/**
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it } from "vitest";
import {
  type ExecutionJobData,
  JobNotAcceptedByPoolError,
  ScenarioExecutionPool,
} from "../execution-pool";
import { isNotVoiceJob, isVoiceJob } from "../voice-worker-only";

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

  describe("given a pool that refuses voice jobs (a normal worker)", () => {
    /**
     * The mirror of isVoiceJob. A normal worker's pool must refuse a voice
     * job rather than silently run it — a voice job that lands here has no
     * media listener to authenticate Twilio's dial-back (the listener only
     * boots on a voice worker), so its nonce registration would register in
     * a process nothing will ever look up.
     * @scenario "A normal worker never runs a voice job"
     */
    it("refuses a voice job so a voice worker runs it instead", () => {
      const pool = new ScenarioExecutionPool({
        concurrency: 10,
        acceptJob: isNotVoiceJob,
      });
      const started: string[] = [];
      pool.setSpawnFunction((j) => {
        started.push(j.scenarioRunId);
        return new Promise<void>(() => {});
      });

      expect(() => pool.submit(job({ n: 1, type: "voice" }))).toThrow(
        JobNotAcceptedByPoolError,
      );
      expect(started).toEqual([]);
    });

    /** @scenario "A normal worker never runs a voice job" */
    it("starts a non-voice job submitted to the same pool", () => {
      const pool = new ScenarioExecutionPool({
        concurrency: 10,
        acceptJob: isNotVoiceJob,
      });
      const started: string[] = [];
      pool.setSpawnFunction((j) => {
        started.push(j.scenarioRunId);
        return new Promise<void>(() => {});
      });

      pool.submit(job({ n: 2, type: "http" }));
      expect(started).toEqual(["run-2"]);
    });
  });

  describe("given both worker predicates installed as a pair", () => {
    /**
     * The two predicates must be exact complements: every job shape is
     * accepted by exactly one of them, never both and never neither. That
     * exactness is what makes the in-process nonce registry correct — see
     * voice-worker-only.ts's doc comment.
     * @scenario "The voice-worker and normal-worker predicates partition every job"
     */
    it("accepts every job shape on exactly one of the two predicates", () => {
      const targetTypes: Array<ExecutionJobData["target"]["type"]> = [
        "prompt",
        "http",
        "code",
        "workflow",
        "connected",
        "voice",
      ];
      for (const type of targetTypes) {
        const j = job({ n: 1, type });
        expect(isVoiceJob(j) !== isNotVoiceJob(j)).toBe(true);
        expect(isVoiceJob(j)).toBe(type === "voice");
      }
    });
  });
});
