import type { ScenarioExecutionService } from "@langwatch/scenario-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type {
  CancellationSubscriber,
  ScenarioChildBootstrap,
  ScenarioProcessorServiceMetrics,
} from "../../app/scenario.app.ts";
import { ScenarioExecutionPoolService } from "../scenario-execution-pool.service.ts";
import type { ExecutionJobData } from "../scenario-execution-pool.service.ts";
import { ScenarioProcessorService } from "../scenario-processor.service.ts";

const JOB = {
  projectId: "proj_123",
  scenarioRunId: "scenariorun_test123",
};

describe("ScenarioProcessorService.recordBestEffort", () => {
  describe("given a recorder that succeeds", () => {
    it("logs nothing", async () => {
      const { logger, lines } = createTestLogger();

      await ScenarioProcessorService.recordBestEffort({
        what: "a detail",
        jobData: JOB,
        record: async () => undefined,
        jobLogger: logger,
      });

      expect(lines.findLine("warn", "Could not record a detail")).toBeUndefined();
    });
  });

  describe("given a recorder that throws", () => {
    it("swallows the failure so the completed job is never lost", async () => {
      const record = vi.fn().mockRejectedValue(new Error("side channel down"));
      const { logger, lines } = createTestLogger();

      await expect(
        ScenarioProcessorService.recordBestEffort({
          what: "a detail",
          jobData: JOB,
          record,
          jobLogger: logger,
        }),
      ).resolves.toBeUndefined();

      const warned = lines.findLine("warn", "Could not record a detail");
      expect(warned).toMatchObject({
        scenarioRunId: JOB.scenarioRunId,
        projectId: JOB.projectId,
      });
    });

    it("logs at the level the caller asks for", async () => {
      const { logger, lines } = createTestLogger();

      await ScenarioProcessorService.recordBestEffort({
        what: "a detail",
        jobData: JOB,
        record: () => Promise.reject(new Error("side channel down")),
        jobLogger: logger,
        level: "error",
      });

      expect(lines.findLine("error", "Could not record a detail")).toMatchObject({
        projectId: JOB.projectId,
      });
      expect(lines.findLine("warn", "Could not record a detail")).toBeUndefined();
    });
  });
});

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

describe("ScenarioProcessorService.recordHooks, when the hooks cannot be written", () => {
  const jobData: ExecutionJobData = {
    ...JOB,
    scenarioId: "scen_456",
    setId: "set_789",
    batchRunId: "batch_abc",
    target: { type: "connected", referenceId: "agent_1" },
  };

  function processorWhoseHooksWriteFails(): ScenarioProcessorService {
    const execution = createApiFixture<ScenarioExecutionService>();
    execution.recordHooks = vi
      .fn<ScenarioExecutionService["recordHooks"]>()
      .mockRejectedValue(new Error("event log down"));
    return ScenarioProcessorService.create({
      execution,
      pool: ScenarioExecutionPoolService.create({ concurrency: 1 }),
      cancellations: new SilentCancellations(),
      childProcesses: createApiFixture<ScenarioChildBootstrap>(),
      metrics: new SilentMetrics(),
    });
  }

  it("logs an unscored run's lost setup as an error, with the project id", async () => {
    const { logger, lines } = createTestLogger();

    await processorWhoseHooksWriteFails().recordHooks({
      jobData,
      result: { success: false, hooks: { setup: { status: "failed", durationMs: 5 } } },
      jobLogger: logger,
    });

    expect(lines.findLine("error", "Could not record a failed setup")).toMatchObject({
      scenarioRunId: JOB.scenarioRunId,
      projectId: JOB.projectId,
    });
  });

  it("logs a scored run's lost hooks as a warning", async () => {
    const { logger, lines } = createTestLogger();

    await processorWhoseHooksWriteFails().recordHooks({
      jobData,
      result: { success: true, hooks: { setup: { status: "ok", durationMs: 5 } } },
      jobLogger: logger,
    });

    expect(
      lines.findLine("warn", "Could not record the run's setup and teardown results"),
    ).toMatchObject({ projectId: JOB.projectId });
    expect(lines.findLine("error", "Could not record a failed setup")).toBeUndefined();
  });
});
