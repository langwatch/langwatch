import { createLogger } from "@langwatch/observability";
import {
  isCancellableStatus,
  type CancelScenarioBatchInput,
  type CancelScenarioRunInput,
  type SimulationService,
} from "@langwatch/scenario-contract";

import type { ScenarioClock } from "../app/scenario.app.ts";

const logger = createLogger("langwatch:scenarios");

export type ScenarioRunCancellationServiceOptions = {
  simulations: SimulationService;
  clock: ScenarioClock;
};

/** Cancels one scenario run or every cancellable run of a batch. */
export class ScenarioRunCancellationService {
  static create(options: ScenarioRunCancellationServiceOptions): ScenarioRunCancellationService {
    return new ScenarioRunCancellationService(options);
  }

  private constructor(private readonly options: ScenarioRunCancellationServiceOptions) {}

  async cancelJob(input: CancelScenarioRunInput): Promise<{ cancelled: boolean }> {
    logger.info(
      {
        projectId: input.projectId,
        scenarioRunId: input.scenarioRunId,
        batchRunId: input.batchRunId,
      },
      "Cancelling scenario job",
    );

    const batch = await this.options.simulations.getRunDataForBatchRun({
      projectId: input.projectId,
      scenarioSetId: input.scenarioSetId,
      batchRunId: input.batchRunId,
    });
    const runs = batch.changed ? batch.runs : [];
    const run = runs.find((candidate) => candidate.scenarioRunId === input.scenarioRunId);
    if (run && !isCancellableStatus(run.status)) {
      return { cancelled: false };
    }

    return this.requestCancellation(input.projectId, input.scenarioRunId);
  }

  /**
   * Dispatches the cancel command for one run, with no status read of its own. `cancelJob` reads
   * and guards before calling this because it is the single-run door and nothing has filtered for
   * it.
   */
  private async requestCancellation(
    projectId: string,
    scenarioRunId: string,
  ): Promise<{ cancelled: boolean }> {
    await this.options.simulations.cancelRun({
      tenantId: projectId,
      scenarioRunId,
      occurredAt: this.options.clock.now().epochMilliseconds,
    });

    return { cancelled: true };
  }

  async cancelBatchRun(input: CancelScenarioBatchInput): Promise<{
    cancelledCount: number;
    skippedCount: number;
  }> {
    const batch = await this.options.simulations.getRunDataForBatchRun({
      projectId: input.projectId,
      scenarioSetId: input.scenarioSetId,
      batchRunId: input.batchRunId,
    });
    const runs = batch.changed ? batch.runs : [];
    const cancellable = runs.filter((run) => isCancellableStatus(run.status));
    let cancelledCount = 0;

    for (let index = 0; index < cancellable.length; index += 10) {
      const chunk = cancellable.slice(index, index + 10);
      const results = await Promise.all(
        chunk.map((run) => this.requestCancellation(input.projectId, run.scenarioRunId)),
      );
      cancelledCount += results.filter((result) => result.cancelled).length;
    }

    return {
      cancelledCount,
      skippedCount: runs.length - cancellable.length,
    };
  }
}
