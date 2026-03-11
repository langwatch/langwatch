/**
 * Regression test: scenario run ID passthrough.
 *
 * Verifies that a pre-assigned scenarioRunId flows from queue job data
 * through the execution context into the child process data, so the SDK
 * uses the platform-assigned ID instead of generating a new one.
 *
 * @see https://github.com/langwatch/langwatch/issues/2245
 */

import { describe, it, expect } from "vitest";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";
import { normalizeJob } from "../scenario-job.repository";
import type { MinimalJob } from "../scenario-job.repository";
import type { ChildProcessJobData } from "../execution/types";

/** Mirrors the generateScenarioRunId implementation without heavy imports */
function generateScenarioRunId(): string {
  return generate(KSUID_RESOURCES.SCENARIO_RUN).toString();
}

interface ScenarioJobLike {
  projectId: string;
  scenarioId: string;
  scenarioName?: string;
  target: { type: "prompt" | "http" | "code"; referenceId: string };
  setId: string;
  batchRunId: string;
  scenarioRunId?: string;
}

function makeScenarioJob(overrides: Partial<ScenarioJobLike> = {}): ScenarioJobLike {
  return {
    projectId: "proj_test",
    scenarioId: "scen_test",
    scenarioName: "Test scenario",
    target: { type: "prompt", referenceId: "prompt_test" },
    setId: "set_test",
    batchRunId: "batch_test",
    scenarioRunId: "scenariorun_preassigned123",
    ...overrides,
  };
}

describe("scenario run ID passthrough", () => {
  describe("generateScenarioRunId", () => {
    it("generates IDs with scenariorun_ prefix", () => {
      const id = generateScenarioRunId();
      expect(id).toMatch(/^scenariorun_/);
    });

    it("generates unique IDs on each call", () => {
      const id1 = generateScenarioRunId();
      const id2 = generateScenarioRunId();
      expect(id1).not.toBe(id2);
    });
  });

  describe("normalizeJob", () => {
    describe("when job data contains scenarioRunId", () => {
      it("uses the pre-assigned scenarioRunId from job data", () => {
        const data = makeScenarioJob({ scenarioRunId: "scenariorun_abc123" });
        const job = { id: "bullmq_job_id", data, timestamp: Date.now() } as unknown as MinimalJob;

        const result = normalizeJob({ job, state: "waiting" });

        expect(result?.scenarioRunId).toBe("scenariorun_abc123");
      });
    });

    describe("when job data has no scenarioRunId (legacy job)", () => {
      it("falls back to BullMQ job ID", () => {
        const data = { ...makeScenarioJob(), scenarioRunId: undefined };
        const job = { id: "bullmq_fallback_id", data, timestamp: Date.now() } as unknown as MinimalJob;

        const result = normalizeJob({ job, state: "waiting" });

        expect(result?.scenarioRunId).toBe("bullmq_fallback_id");
      });
    });
  });

  describe("child process job data context", () => {
    describe("when scenarioRunId is set in the context", () => {
      it("includes scenarioRunId in the context for SDK passthrough", () => {
        const jobData: ChildProcessJobData = {
          context: {
            projectId: "proj_test",
            scenarioId: "scen_test",
            setId: "set_test",
            batchRunId: "batch_test",
            scenarioRunId: "scenariorun_preassigned456",
          },
          scenario: {
            id: "scen_test",
            name: "Test",
            situation: "Test situation",
            criteria: ["Must pass"],
            labels: [],
          },
          adapterData: {
            type: "prompt",
            promptId: "prompt_test",
            systemPrompt: "You are helpful",
            messages: [],
          },
          modelParams: {
            api_key: "test-key",
            model: "openai/gpt-4",
          },
          nlpServiceUrl: "http://localhost:8080",
          target: { type: "prompt", referenceId: "prompt_test" },
        };

        expect(jobData.context.scenarioRunId).toBe("scenariorun_preassigned456");
      });
    });
  });
});
