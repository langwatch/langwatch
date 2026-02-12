/**
 * Scenario execution queue using BullMQ.
 *
 * Jobs are processed in a separate worker process with isolated OTEL context,
 * ensuring scenario traces don't mix with server telemetry.
 *
 * @see https://github.com/langwatch/langwatch/issues/1088
 */

import type { ConnectionOptions, Job } from "bullmq";
import { generate } from "@langwatch/ksuid";
import { z } from "zod";
import { KSUID_RESOURCES } from "~/utils/constants";
import { createLogger } from "~/utils/logger/server";
import { QueueWithFallback } from "../background/queues/queueWithFallback";
import { connection } from "../redis";
import { SCENARIO_QUEUE } from "./scenario.constants";
import { processScenarioJob } from "./scenario.processor";

const logger = createLogger("langwatch:scenarios:queue");

/**
 * Schema for scenario job data.
 * Kept minimal - processor fetches full data from database.
 */
export const scenarioJobSchema = z.object({
  projectId: z.string(),
  scenarioId: z.string(),
  target: z.object({
    type: z.enum(["prompt", "http", "code"]),
    referenceId: z.string(),
  }),
  setId: z.string(),
  batchRunId: z.string(),
});

/** Data required to execute a scenario job. */
export type ScenarioJob = z.infer<typeof scenarioJobSchema>;

/**
 * Schema for scenario job result.
 */
export const scenarioJobResultSchema = z.object({
  success: z.boolean(),
  runId: z.string().optional(),
  error: z.string().optional(),
  reasoning: z.string().optional(),
});

/** Result of scenario execution. */
export type ScenarioJobResult = z.infer<typeof scenarioJobResultSchema>;

/**
 * Scenario execution queue with fallback to direct processing.
 */
export const scenarioQueue = new QueueWithFallback<
  ScenarioJob,
  ScenarioJobResult,
  string
>(SCENARIO_QUEUE.NAME, processScenarioJob, {
  connection: connection as ConnectionOptions,
  defaultJobOptions: {
    backoff: {
      type: "exponential",
      delay: SCENARIO_QUEUE.BACKOFF_DELAY_MS,
    },
    attempts: SCENARIO_QUEUE.MAX_ATTEMPTS,
    removeOnComplete: {
      age: SCENARIO_QUEUE.COMPLETED_JOB_RETENTION_SECONDS,
    },
    removeOnFail: {
      age: SCENARIO_QUEUE.FAILED_JOB_RETENTION_SECONDS,
    },
  },
});

/** Generates a unique batch run ID for grouping scenario executions */
export function generateBatchRunId(): string {
  return generate(KSUID_RESOURCES.SCENARIO_BATCH).toString();
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

  return await scenarioQueue.add(SCENARIO_QUEUE.JOB, params, {
    jobId,
    delay: options?.delay,
    priority: options?.priority,
  });
}
