/**
 * Scenario execution queue using BullMQ.
 *
 * Jobs are processed in a separate worker process with isolated OTEL context,
 * ensuring scenario traces don't mix with server telemetry.
 *
 * @see https://github.com/langwatch/langwatch/issues/1088
 */

import type { ConnectionOptions, Job } from "bullmq";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger";
import { QueueWithFallback } from "../background/queues/queueWithFallback";
import { connection } from "../redis";
import { processScenarioJob } from "./scenario.processor";

const logger = createLogger("langwatch:scenarios:queue");

export const SCENARIO_QUEUE_NAME = "{scenarios}";

/**
 * Data required to execute a scenario job.
 * Kept minimal - processor fetches full data from database.
 */
export type ScenarioJob = {
  projectId: string;
  scenarioId: string;
  target: {
    type: "prompt" | "http";
    referenceId: string;
  };
  setId: string;
  batchRunId: string;
};

/**
 * Result of scenario execution.
 */
export type ScenarioJobResult = {
  success: boolean;
  runId?: string;
  error?: string;
  reasoning?: string;
};

/**
 * Scenario execution queue with fallback to direct processing.
 */
export const scenarioQueue = new QueueWithFallback<
  ScenarioJob,
  ScenarioJobResult,
  string
>(SCENARIO_QUEUE_NAME, processScenarioJob, {
  connection: connection as ConnectionOptions,
  defaultJobOptions: {
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    attempts: 3,
    removeOnComplete: {
      age: 60 * 60, // 1 hour
    },
    removeOnFail: {
      age: 60 * 60 * 24 * 3, // 3 days
    },
  },
});

/** Generates a unique batch run ID for grouping scenario executions */
export function generateBatchRunId(): string {
  return `scenariobatch_${nanoid()}`;
}

/**
 * Schedule a scenario for execution.
 *
 * @param params - Scenario execution parameters
 * @param options - Optional job configuration (delay, priority, etc.)
 */
export async function scheduleScenarioRun(
  params: ScenarioJob,
  options?: { delay?: number; priority?: number },
): Promise<Job<ScenarioJob, ScenarioJobResult, string>> {
  const { projectId, scenarioId, batchRunId } = params;

  const jobId = `scenario_${projectId}_${scenarioId}_${batchRunId}`;

  logger.info(
    { scenarioId, projectId, batchRunId, jobId },
    "Scheduling scenario execution",
  );

  const existingJob = await scenarioQueue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === "failed" || state === "completed") {
      logger.info({ jobId, state }, "Retrying existing job");
      await existingJob.retry(state);
      return existingJob;
    }
    logger.info({ jobId, state }, "Job already exists, skipping");
    return existingJob;
  }

  return await scenarioQueue.add("scenario", params, {
    jobId,
    delay: options?.delay,
    priority: options?.priority,
  });
}
