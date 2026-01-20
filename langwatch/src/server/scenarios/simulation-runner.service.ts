import type { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger";
import type { SimulationTarget } from "../api/routers/scenarios";
import { ScenarioWorkerManager } from "./worker/scenario-worker-manager";

/** Default scenario set for local/quick runs */
const _DEFAULT_SIMULATION_SET_ID = "local-scenarios";

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
 * Architecture:
 * - SimulationRunnerService (main process): Coordinates execution, validates inputs
 * - ScenarioWorkerManager (main process): Pre-fetches data, spawns workers
 * - scenario-worker.ts (worker thread): Isolated OTEL setup, runs scenario
 *
 * @see https://github.com/langwatch/langwatch/issues/1088
 */
export class SimulationRunnerService {
  private readonly workerManager: ScenarioWorkerManager;

  constructor(private readonly prisma: PrismaClient) {
    this.workerManager = ScenarioWorkerManager.create(prisma);
  }

  /**
   * Execute a scenario against a target in an isolated worker thread.
   *
   * The scenario runs in a separate worker thread with its own OpenTelemetry
   * context, ensuring traces are properly captured and sent to LangWatch
   * without interfering with the server's global OTEL setup.
   */
  async execute(params: ExecuteParams): Promise<void> {
    const { projectId, scenarioId, target, setId, batchRunId } = params;

    // Validate batchRunId
    if (!batchRunId || typeof batchRunId !== "string") {
      logger.error(
        { batchRunId, type: typeof batchRunId },
        "Invalid batchRunId",
      );
      throw new Error(`Invalid batchRunId: ${batchRunId}`);
    }

    logger.info(
      {
        scenarioId,
        setId,
        batchRunId,
        targetType: target.type,
      },
      "Starting scenario execution in isolated worker",
    );

    try {
      // Execute scenario in isolated worker thread
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
    } catch (error) {
      logger.error(
        { error, scenarioId, projectId, setId },
        "Scenario worker execution failed",
      );
    }
  }

  static create(prisma: PrismaClient): SimulationRunnerService {
    return new SimulationRunnerService(prisma);
  }
}
