/**
 * Scenario job processor for BullMQ.
 *
 * Thin wrapper that delegates to the orchestrator for actual execution.
 * Handles BullMQ worker setup and job lifecycle.
 *
 * @see https://github.com/langwatch/langwatch/issues/1088
 */

import type { Job, Worker } from "bullmq";
import { Worker as BullMQWorker } from "bullmq";
import { createLogger } from "~/utils/logger";
import { connection } from "../redis";
import { createOrchestrator } from "./execution/orchestrator.factory";
import { SCENARIO_QUEUE, SCENARIO_WORKER } from "./scenario.constants";
import type { ScenarioJob, ScenarioJobResult } from "./scenario.queue";

const logger = createLogger("langwatch:scenarios:processor");

/**
 * Process a scenario job by delegating to the orchestrator.
 */
export async function processScenarioJob(
  job: Job<ScenarioJob, ScenarioJobResult, string>,
): Promise<ScenarioJobResult> {
  const { projectId, scenarioId, target, setId, batchRunId } = job.data;

  logger.info(
    { jobId: job.id, scenarioId, projectId, batchRunId },
    "Processing scenario job",
  );

  const orchestrator = createOrchestrator();

  const result = await orchestrator.execute({
    context: { projectId, scenarioId, setId, batchRunId },
    target,
  });

  logger.info(
    { jobId: job.id, scenarioId, success: result.success },
    "Scenario job completed",
  );

  return result;
}

/**
 * Start the scenario processor (BullMQ worker).
 *
 * This should be called from a separate entry point (scenario-worker.ts)
 * that has its own OTEL instrumentation.
 */
export function startScenarioProcessor(): Worker<
  ScenarioJob,
  ScenarioJobResult,
  string
> | undefined {
  if (!connection) {
    logger.info("No Redis connection, skipping scenario processor");
    return undefined;
  }

  const worker = new BullMQWorker<ScenarioJob, ScenarioJobResult, string>(
    SCENARIO_QUEUE.NAME,
    processScenarioJob,
    {
      connection,
      concurrency: SCENARIO_WORKER.CONCURRENCY,
      stalledInterval: SCENARIO_WORKER.STALLED_INTERVAL_MS,
    },
  );

  worker.on("ready", () => {
    logger.info("Scenario processor ready, waiting for jobs");
  });

  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, error, data: job?.data },
      "Scenario job failed",
    );
  });

  worker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, scenarioId: job.data.scenarioId },
      "Scenario job completed",
    );
  });

  logger.info("Scenario processor started");
  return worker;
}
