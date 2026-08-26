import type { IntentContext } from "@langwatch/eventing";
import {
  ScenarioExecutionService,
  type ScenarioExecutionJob,
  type ScenarioExecutionPrefetchInput,
  type ScenarioExecutionPrefetchResult,
  type ScenarioExecutionPreparation,
  type ScenarioUnsuccessfulExecutionInput,
} from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createCancelExecutionHandler,
  createExecuteRunHandler,
  createFinishRunHandler,
} from "../src/intents/simulation-run-execution.intent";
import type {
  CancelExecutionIntent,
  ExecuteRunIntent,
  FinishRunIntent,
} from "../src/processes/simulation-run-execution-data.process";
import { TestSimulationService } from "./test-simulation.service";

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

function makeExecutePayload(overrides: Partial<ExecuteRunIntent> = {}): ExecuteRunIntent {
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

class TestScenarioExecutionService extends ScenarioExecutionService {
  constructor(
    private readonly submitJob: (job: ScenarioExecutionJob) => Promise<void>,
    private readonly cancelJob: (input: {
      projectId: string;
      scenarioRunId: string;
    }) => Promise<void> = () => Promise.resolve(),
  ) {
    super();
  }

  submit(job: ScenarioExecutionJob): Promise<void> {
    return this.submitJob(job);
  }

  cancel(input: { projectId: string; scenarioRunId: string }): Promise<void> {
    return this.cancelJob(input);
  }

  prefetch(
    _input: ScenarioExecutionPrefetchInput,
  ): Promise<ScenarioExecutionPrefetchResult> {
    throw new Error("prefetch unexpectedly called in simulation intent tests");
  }

  prepare(_input: ScenarioExecutionPrefetchInput): ScenarioExecutionPreparation {
    throw new Error("prepare unexpectedly called in simulation intent tests");
  }

  finishUnsuccessfulRun(_input: ScenarioUnsuccessfulExecutionInput): Promise<void> {
    throw new Error(
      "finishUnsuccessfulRun unexpectedly called in simulation intent tests",
    );
  }
}

function executionService(
  submit: (job: ScenarioExecutionJob) => void,
): ScenarioExecutionService {
  return new TestScenarioExecutionService((job) => {
    submit(job);
    return Promise.resolve();
  });
}

describe("createExecuteRunHandler", () => {
  describe("when this pod has no execution pool", () => {
    /** @scenario "The execute intent survives a worker restart" */
    it("throws so the outbox retries instead of silently dropping the run", async () => {
      const execution = new TestScenarioExecutionService(() =>
        Promise.reject(
          new Error(
            "No execution pool on this pod; outbox will retry execute for scenarioRunId=run-1",
          ),
        ),
      );
      const run = createExecuteRunHandler(execution);

      await expect(run(makeExecutePayload(), makeContext())).rejects.toThrow(
        /No execution pool on this pod.*run-1/,
      );
    });
  });

  describe("when this pod has an execution pool", () => {
    it("submits the job mapped onto ExecutionJobData", async () => {
      const submit = vi.fn();
      const run = createExecuteRunHandler(executionService(submit));

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

    it("forwards the run's parameters onto the pool job", async () => {
      const submit = vi.fn();
      const run = createExecuteRunHandler(executionService(submit));

      await run(
        makeExecutePayload({
          parameters: { account_tier: "platinum", seats: 12 },
        }),
        makeContext(),
      );

      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: { account_tier: "platinum", seats: 12 },
        }),
      );
    });

    it("omits scenarioName when the intent carries no name", async () => {
      const submit = vi.fn();
      const run = createExecuteRunHandler(executionService(submit));
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
    const run = createCancelExecutionHandler(
      new TestScenarioExecutionService(() => Promise.resolve(), publishCancellation),
    );
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
    const publishCancellation = vi.fn().mockRejectedValue(new Error("redis down"));
    const run = createCancelExecutionHandler(
      new TestScenarioExecutionService(() => Promise.resolve(), publishCancellation),
    );

    await expect(
      run({ scenarioRunId: RUN_ID, projectId: PROJECT_ID }, makeContext()),
    ).rejects.toThrow("redis down");
  });
});

describe("createFinishRunHandler", () => {
  it("reports the terminal outcome through the pipeline commands", async () => {
    const finishRun = vi.fn().mockResolvedValue(undefined);
    const run = createFinishRunHandler(new TestSimulationService(finishRun));
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
    const run = createFinishRunHandler(new TestSimulationService(finishRun));

    await run(
      { scenarioRunId: RUN_ID, projectId: PROJECT_ID, status: "CANCELLED" },
      makeContext(),
    );

    expect(finishRun).toHaveBeenCalledWith(
      expect.not.objectContaining({ error: expect.anything() }),
    );
  });
});
