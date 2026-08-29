import type {
  ScenarioExecutionJob,
  ScenarioExecutionPrefetchInput,
  ScenarioExecutionPrefetchResult,
} from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import {
  CancellationPublisherPort,
  ScenarioExecutionPoolService,
  ScenarioExecutionPrefetcherService,
  ScenarioExecutionService,
  ScenarioFailureHandlerService,
  ScenarioExecutionRunnerPort,
  UnavailableScenarioExecutionPoolService,
} from "../index";

const job: ScenarioExecutionJob = {
  projectId: "project-1",
  scenarioId: "scenario-1",
  scenarioRunId: "run-1",
  batchRunId: "batch-1",
  setId: "set-1",
  target: { type: "prompt", referenceId: "prompt-1" },
};

class TestRunner extends ScenarioExecutionRunnerPort {
  constructor(private readonly executeJob: (input: ScenarioExecutionJob) => void) {
    super();
  }

  execute(input: ScenarioExecutionJob): Promise<void> {
    this.executeJob(input);
    return Promise.resolve();
  }

  skipCancelled(): void {}
}

class TestCancellationPublisher extends CancellationPublisherPort {
  readonly publish = vi.fn().mockResolvedValue(undefined);
}

function prefetcher(): ScenarioExecutionPrefetcherService {
  return Object.create(
    ScenarioExecutionPrefetcherService.prototype,
  ) as ScenarioExecutionPrefetcherService;
}

function failures(): ScenarioFailureHandlerService {
  return Object.create(
    ScenarioFailureHandlerService.prototype,
  ) as ScenarioFailureHandlerService;
}

describe("ScenarioExecutionService", () => {
  it("throws when this process has no execution pool", async () => {
    const service = ScenarioExecutionService.create({
      pool: UnavailableScenarioExecutionPoolService.create(),
      cancellations: new TestCancellationPublisher(),
      prefetcher: prefetcher(),
      failures: failures(),
    });

    await expect(service.submit(job)).rejects.toThrow(
      /No execution pool on this pod.*run-1/,
    );
  });

  it("submits through the process-owned pool", async () => {
    const execute = vi.fn();
    const pool = ScenarioExecutionPoolService.create({ concurrency: 1 });
    pool.connect(new TestRunner(execute));
    const service = ScenarioExecutionService.create({
      pool,
      cancellations: new TestCancellationPublisher(),
      prefetcher: prefetcher(),
      failures: failures(),
    });

    await service.submit(job);

    expect(execute).toHaveBeenCalledWith(job);
  });

  it("publishes cancellation through the composed transport", async () => {
    const cancellations = new TestCancellationPublisher();
    const service = ScenarioExecutionService.create({
      pool: UnavailableScenarioExecutionPoolService.create(),
      cancellations,
      prefetcher: prefetcher(),
      failures: failures(),
    });

    await service.cancel({ projectId: "project-1", scenarioRunId: "run-1" });

    expect(cancellations.publish).toHaveBeenCalledWith({
      projectId: "project-1",
      scenarioRunId: "run-1",
    });
  });

  it("keeps preparation behind the canonical execution service", async () => {
    const preparationService = prefetcher();
    const input: ScenarioExecutionPrefetchInput = {
      context: {
        projectId: "project-1",
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        setId: "set-1",
      },
      target: { type: "prompt", referenceId: "prompt-1" },
    };
    const result: ScenarioExecutionPrefetchResult = {
      success: false,
      error: "invalid target",
    };
    const preparation = {
      childEnvironment: Promise.resolve(null),
      result: Promise.resolve(result),
    };
    preparationService.prefetch = vi.fn().mockResolvedValue(result);
    preparationService.prepare = vi.fn().mockReturnValue(preparation);
    const service = ScenarioExecutionService.create({
      pool: UnavailableScenarioExecutionPoolService.create(),
      cancellations: new TestCancellationPublisher(),
      prefetcher: preparationService,
      failures: failures(),
    });

    await expect(service.prefetch(input)).resolves.toEqual(result);
    expect(service.prepare(input)).toBe(preparation);
    expect(preparationService.prefetch).toHaveBeenCalledWith(input);
    expect(preparationService.prepare).toHaveBeenCalledWith(input);
  });

  it("finishes unsuccessful runs through the canonical execution service", async () => {
    const failureHandler = failures();
    failureHandler.finishUnsuccessfulRun = vi.fn().mockResolvedValue(undefined);
    const service = ScenarioExecutionService.create({
      pool: UnavailableScenarioExecutionPoolService.create(),
      cancellations: new TestCancellationPublisher(),
      prefetcher: prefetcher(),
      failures: failureHandler,
    });
    const input = {
      projectId: "project-1",
      scenarioId: "scenario-1",
      scenarioRunId: "run-1",
      batchRunId: "batch-1",
      setId: "set-1",
      error: "stalled",
    };

    await service.finishUnsuccessfulRun(input);

    expect(failureHandler.finishUnsuccessfulRun).toHaveBeenCalledWith(input);
  });
});
