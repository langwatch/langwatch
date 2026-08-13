import { describe, expect, it, vi } from "vitest";

import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import {
  createCancelExecutionHandler,
  createExecuteRunHandler,
  createFinishRunHandler,
  type SimulationRunExecutionDispatchDeps,
} from "../simulationRunExecutionIntentHandlers";
import type {
  CancelExecutionIntent,
  ExecuteRunIntent,
  FinishRunIntent,
} from "../simulationRunExecutionProcess.types";

const RUN_ID = "run-1";
const PROJECT_ID = "project-1";

function makeContext(overrides: Partial<IntentContext> = {}): IntentContext {
  return {
    processName: "simulation_run_execution",
    projectId: PROJECT_ID,
    processKey: RUN_ID,
    tenantId: PROJECT_ID,
    messageKey: `process:${RUN_ID}:execute:${RUN_ID}`,
    attempt: 1,
    ...overrides,
  };
}

function makeExecutePayload(
  overrides: Partial<ExecuteRunIntent> = {},
): ExecuteRunIntent {
  return {
    scenarioRunId: RUN_ID,
    projectId: PROJECT_ID,
    scenarioId: "scenario-1",
    batchRunId: "batch-1",
    scenarioSetId: "set-1",
    name: "Test simulation",
    target: { type: "prompt", referenceId: "prompt-1" },
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<SimulationRunExecutionDispatchDeps> = {},
): SimulationRunExecutionDispatchDeps {
  return {
    getPool: () => ({ submit: vi.fn() }),
    publishCancellation: vi.fn().mockResolvedValue(undefined),
    commands: () => ({ finishRun: vi.fn().mockResolvedValue(undefined) }),
    ...overrides,
  };
}

describe("createExecuteRunHandler", () => {
  describe("when this pod has no execution pool", () => {
    it("throws so the outbox retries instead of silently dropping the run", async () => {
      const run = createExecuteRunHandler(makeDeps({ getPool: () => null }));

      await expect(run(makeExecutePayload(), makeContext())).rejects.toThrow(
        /No execution pool on this pod.*run-1/,
      );
    });
  });

  describe("when this pod has an execution pool", () => {
    it("submits the job mapped onto ExecutionJobData", async () => {
      const submit = vi.fn();
      const run = createExecuteRunHandler(
        makeDeps({ getPool: () => ({ submit }) }),
      );

      await run(makeExecutePayload(), makeContext());

      expect(submit).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        scenarioId: "scenario-1",
        scenarioRunId: RUN_ID,
        batchRunId: "batch-1",
        setId: "set-1",
        scenarioName: "Test simulation",
        target: { type: "prompt", referenceId: "prompt-1" },
      });
    });

    it("omits scenarioName when the intent carries no name", async () => {
      const submit = vi.fn();
      const run = createExecuteRunHandler(
        makeDeps({ getPool: () => ({ submit }) }),
      );
      const payload = makeExecutePayload();
      delete payload.name;

      await run(payload, makeContext());

      expect(submit).toHaveBeenCalledWith(
        expect.not.objectContaining({ scenarioName: expect.anything() }),
      );
    });
  });
});

describe("createCancelExecutionHandler", () => {
  it("broadcasts the cancellation with the run identity", async () => {
    const publishCancellation = vi.fn().mockResolvedValue(undefined);
    const run = createCancelExecutionHandler(makeDeps({ publishCancellation }));
    const payload: CancelExecutionIntent = {
      scenarioRunId: RUN_ID,
      projectId: PROJECT_ID,
    };

    await run(payload, makeContext());

    expect(publishCancellation).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      scenarioRunId: RUN_ID,
    });
  });

  it("propagates a publish failure so the outbox retries", async () => {
    const publishCancellation = vi
      .fn()
      .mockRejectedValue(new Error("redis down"));
    const run = createCancelExecutionHandler(makeDeps({ publishCancellation }));

    await expect(
      run({ scenarioRunId: RUN_ID, projectId: PROJECT_ID }, makeContext()),
    ).rejects.toThrow("redis down");
  });
});

describe("createFinishRunHandler", () => {
  it("reports the terminal outcome through the pipeline commands", async () => {
    const finishRun = vi.fn().mockResolvedValue(undefined);
    const run = createFinishRunHandler(
      makeDeps({ commands: () => ({ finishRun }) }),
    );
    const payload: FinishRunIntent = {
      scenarioRunId: RUN_ID,
      projectId: PROJECT_ID,
      status: "ERROR",
      error: "stalled",
    };

    await run(payload, makeContext());

    expect(finishRun).toHaveBeenCalledWith({
      tenantId: PROJECT_ID,
      scenarioRunId: RUN_ID,
      status: "ERROR",
      error: "stalled",
      occurredAt: expect.any(Number),
    });
  });

  it("omits error when the intent carries none", async () => {
    const finishRun = vi.fn().mockResolvedValue(undefined);
    const run = createFinishRunHandler(
      makeDeps({ commands: () => ({ finishRun }) }),
    );

    await run(
      { scenarioRunId: RUN_ID, projectId: PROJECT_ID, status: "CANCELLED" },
      makeContext(),
    );

    expect(finishRun).toHaveBeenCalledWith(
      expect.not.objectContaining({ error: expect.anything() }),
    );
  });
});
