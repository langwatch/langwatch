import { createLogger } from "~/utils/logger";
import type { SimulationTarget } from "../api/routers/scenarios";
import {
  generateBatchRunId,
  scheduleScenarioRun,
  type ScenarioJobResult,
} from "./scenario.queue";

const logger = createLogger("SimulationRunnerService");

// Re-export for backwards compatibility
export { generateBatchRunId };

interface ExecuteParams {
  projectId: string;
  scenarioId: string;
  target: SimulationTarget;
  setId: string;
  batchRunId: string;
}

/**
 * Service for running scenarios against targets.
 *
 * Scenarios are executed via BullMQ queue with OTEL trace isolation.
 * When Redis is not available, execution falls back to direct processing.
 *
 * @see https://github.com/langwatch/langwatch/issues/1088
 */
export class SimulationRunnerService {
  /**
   * Schedule a scenario for execution.
   *
   * This schedules the scenario on the queue and returns immediately.
   * The actual execution happens asynchronously in the scenario worker.
   *
   * When Redis is unavailable, QueueWithFallback processes the job directly.
   */
  async execute(params: ExecuteParams): Promise<ScenarioJobResult> {
    const { projectId, scenarioId, target, setId, batchRunId } = params;

    if (!batchRunId) {
      throw new Error(`Invalid batchRunId: ${batchRunId}`);
    }

    logger.info(
      { scenarioId, setId, batchRunId, targetType: target.type },
      "Scheduling scenario execution",
    );

    const job = await scheduleScenarioRun({
      projectId,
      scenarioId,
      target: {
        type: target.type,
        referenceId: target.referenceId,
      },
      setId,
      batchRunId,
    });

    logger.info(
      { scenarioId, setId, batchRunId, jobId: job.id },
      "Scenario scheduled",
    );

    // For backwards compatibility, return a pending result
    // The actual result is processed asynchronously by the worker
    return {
      success: true,
      runId: job.id,
    };
  }

  static create(): SimulationRunnerService {
    return new SimulationRunnerService();
  }
}
