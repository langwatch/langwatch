import { createApiFixture } from "@langwatch/api-fixture";
/**
 * What a simulated voice run that ran to the end records when LangWatch cut the call at the limit.
 * @see specs/features/agents/voice-agents-v1.feature
 */
import type { ScenarioExecutionService } from "@langwatch/scenario-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CancellationSubscriber,
  ScenarioChildBootstrap,
  ScenarioProcessorServiceMetrics,
} from "../../app/scenario.app.ts";
import { ScenarioExecutionPoolService } from "../scenario-execution-pool.service.ts";
import type { ExecutionJobData } from "../scenario-execution-pool.service.ts";
import { ScenarioProcessorService } from "../scenario-processor.service.ts";

const JOB: ExecutionJobData = {
  projectId: "proj_123",
  scenarioId: "scen_456",
  setId: "set_789",
  batchRunId: "batch_abc",
  scenarioRunId: "scenariorun_voice1",
  target: { type: "voice", referenceId: "agent_voice" },
};

class SilentCancellations implements CancellationSubscriber {
  subscribe(): Promise<() => Promise<void>> {
    return Promise.resolve(async () => {});
  }
}

class SilentMetrics implements ScenarioProcessorServiceMetrics {
  started(): void {}
  completed(): void {}
  failed(): void {}
}

describe("ScenarioProcessorService.handleSucceeded, cut at the call limit", () => {
  let recordCutAtLimit: ReturnType<typeof vi.fn<ScenarioExecutionService["recordCutAtLimit"]>>;
  let processor: ScenarioProcessorService;

  beforeEach(() => {
    recordCutAtLimit = vi
      .fn<ScenarioExecutionService["recordCutAtLimit"]>()
      .mockResolvedValue(undefined);
    const execution = createApiFixture<ScenarioExecutionService>();
    execution.recordCutAtLimit = recordCutAtLimit;
    processor = ScenarioProcessorService.create({
      execution,
      pool: ScenarioExecutionPoolService.create({ concurrency: 1 }),
      cancellations: new SilentCancellations(),
      childProcesses: createApiFixture<ScenarioChildBootstrap>(),
      metrics: new SilentMetrics(),
    });
  });

  describe("when the child reports the call was cut at the limit", () => {
    /** @scenario "A simulated voice run cut at the call limit records the cutoff marker" */
    it("records the cutoff marker on the run", async () => {
      await processor.handleSucceeded({
        jobData: JOB,
        result: { success: true, isCutAtLimit: true },
      });

      expect(recordCutAtLimit).toHaveBeenCalledWith({
        projectId: "proj_123",
        scenarioRunId: "scenariorun_voice1",
      });
    });

    it("does not fail the job when the marker cannot be written", async () => {
      recordCutAtLimit.mockRejectedValue(new Error("event log down"));

      await expect(
        processor.handleSucceeded({ jobData: JOB, result: { success: true, isCutAtLimit: true } }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the call finished on its own", () => {
    /** @scenario "A simulated voice run that finished normally records no cutoff marker" */
    it("dispatches no cutoff event", async () => {
      await processor.handleSucceeded({ jobData: JOB, result: { success: true } });

      expect(recordCutAtLimit).not.toHaveBeenCalled();
    });
  });
});
