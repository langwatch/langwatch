import type { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger";
import type { SimulationTarget } from "../api/routers/scenarios";
import {
  ScenarioWorkerManager,
  type ScenarioWorkerManagerDeps,
} from "./worker/scenario-worker-manager";
import type { ScenarioWorkerResult } from "./worker/types";

/** Generates a unique batch run ID for grouping scenario executions */
export function generateBatchRunId(): string {
  return `scenariobatch_${nanoid()}`;
}

const logger = createLogger("SimulationRunnerService");

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
 * Scenarios are executed in isolated worker threads to ensure proper
 * OpenTelemetry trace capture. Each worker has its own OTEL context
 * that exports traces to LangWatch, independent of the server's
 * global OTEL configuration.
 *
 * @see https://github.com/langwatch/langwatch/issues/1088
 */
export class SimulationRunnerService {
  constructor(private readonly workerManager: ScenarioWorkerManager) {}

  /**
   * Execute a scenario against a target in an isolated worker thread.
   *
   * Returns the execution result, allowing callers to handle success/failure.
   */
  async execute(params: ExecuteParams): Promise<ScenarioWorkerResult> {
    const { projectId, scenarioId, target, setId, batchRunId } = params;

    if (!batchRunId || typeof batchRunId !== "string") {
      throw new Error(`Invalid batchRunId: ${batchRunId}`);
    }

    logger.info(
      { scenarioId, setId, batchRunId, targetType: target.type },
      "Starting scenario execution in isolated worker",
    );

    const result = await this.workerManager.execute({
      projectId,
      scenarioId,
      target,
      setId,
      batchRunId,
    });

    logger.info(
      {
        scenarioId,
        setId,
        runId: result.runId,
        success: result.success,
        reasoning: result.reasoning,
      },
      "Scenario execution completed",
    );

    if (!result.success && result.error) {
      logger.error(
        { error: result.error, scenarioId, projectId },
        "Scenario execution failed with error",
      );
    }

    return result;
  }

  static create(
    prisma: PrismaClient,
    deps?: Partial<ScenarioWorkerManagerDeps>,
  ): SimulationRunnerService {
    const workerManager = ScenarioWorkerManager.create(prisma, deps);
    return new SimulationRunnerService(workerManager);
  }
}
