/**
 * @see specs/features/agents/voice-phone.feature
 */

import { beforeEach, describe, expect, it } from "vitest";

import { consumesJobClass } from "../rules/resource-class-admission.rules.ts";
import {
  type ExecutionJobData,
  JobNotAcceptedByPoolError,
  ScenarioExecutionPoolService,
} from "../services/scenario-execution-pool.service.ts";

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
    let pool: ScenarioExecutionPoolService;
    let started: string[];

    beforeEach(() => {
      pool = ScenarioExecutionPoolService.create({
        concurrency: 10,
        acceptJob: (j) => consumesJobClass({ consumed: ["voice"], job: j }),
      });
      started = [];
      pool.connect({
        execute: (j) => {
          started.push(j.scenarioRunId);
          return new Promise<void>(() => {});
        },
        skipCancelled: () => {},
      });
    });

    /** @scenario "A voice worker runs only voice jobs" */
    it("refuses a non-voice job so another pod runs it", () => {
      expect(() => pool.submit(job({ n: 1, type: "http" }))).toThrow(JobNotAcceptedByPoolError);
      expect(started).toEqual([]);
    });

    /** @scenario "A voice worker runs only voice jobs" */
    it("starts a voice job submitted to the same pool", () => {
      pool.submit(job({ n: 2, type: "voice" }));
      expect(started).toEqual(["run-2"]);
    });
  });

  describe("given a pool with no admission filter", () => {
    it("runs every job type, unchanged", () => {
      const pool = ScenarioExecutionPoolService.create({ concurrency: 10 });
      const started: string[] = [];
      pool.connect({
        execute: (j) => {
          started.push(j.scenarioRunId);
          return new Promise<void>(() => {});
        },
        skipCancelled: () => {},
      });

      pool.submit(job({ n: 1, type: "http" }));
      pool.submit(job({ n: 2, type: "voice" }));
      expect(started).toEqual(["run-1", "run-2"]);
    });
  });

  describe("given a worker that consumes only the light class", () => {
    const consumed = ["light"] as const;
    const accept = (j: ExecutionJobData) => consumesJobClass({ consumed, job: j });

    /** @scenario "A worker only admits runtime classes it consumes" */
    it("refuses a voice job and starts a light one", () => {
      const pool = ScenarioExecutionPoolService.create({ concurrency: 10, acceptJob: accept });
      pool.connect({ execute: () => new Promise<void>(() => {}), skipCancelled: () => {} });

      expect(() => pool.submit(job({ n: 1, type: "voice" }))).toThrow(JobNotAcceptedByPoolError);
      pool.submit(job({ n: 2, type: "prompt" }));
      expect(pool.activeCount).toBe(1);
    });
  });

  describe("given a worker that consumes every class", () => {
    /** @scenario "A worker only admits runtime classes it consumes" */
    it("admits each target type", () => {
      for (const type of ["prompt", "http", "code", "workflow", "connected", "voice"] as const) {
        expect(consumesJobClass({ consumed: ["light", "voice"], job: job({ n: 1, type }) })).toBe(
          true,
        );
      }
    });
  });
});
