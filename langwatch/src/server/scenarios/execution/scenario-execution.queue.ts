/**
 * Dedicated GroupQueueProcessor for scenario execution.
 *
 * Separate from the ES global queue to provide independent concurrency control.
 * Uses per-scenarioRunId grouping (no FIFO constraint between different runs).
 */

import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { makeQueueName } from "~/server/background/queues/makeQueueName";
import { createLogger } from "~/utils/logger/server";
import { GroupQueueProcessor } from "~/server/event-sourcing/queues/groupQueue/groupQueue";
import type { EventSourcedQueueProcessor } from "~/server/event-sourcing/queues";
import type { ScenarioExecutionParams } from "./scenario-executor";

const logger = createLogger("langwatch:scenarios:execution-queue");

const SCENARIO_EXECUTION_CONCURRENCY =
  Number(process.env.SCENARIO_EXECUTION_CONCURRENCY) || 15;

/** Payload dispatched to the scenario execution queue */
export interface ScenarioExecutionPayload extends Record<string, unknown> {
  projectId: string;
  scenarioId: string;
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
  target: {
    type: "prompt" | "http" | "code";
    referenceId: string;
  };
  attempt: number;
}

export type ScenarioExecutionQueueProcessor =
  EventSourcedQueueProcessor<ScenarioExecutionPayload>;

/**
 * Creates a dedicated scenario execution queue backed by a GroupQueueProcessor.
 *
 * Returns null if Redis is not available.
 */
export function createScenarioExecutionQueue(params: {
  redis: IORedis | Cluster;
  handler: (payload: ScenarioExecutionPayload) => Promise<void>;
  consumerEnabled?: boolean;
}): ScenarioExecutionQueueProcessor {
  const { redis, handler, consumerEnabled } = params;

  const queueName = makeQueueName("scenarios/execution");

  logger.info(
    { queueName, concurrency: SCENARIO_EXECUTION_CONCURRENCY },
    "Creating scenario execution queue",
  );

  return new GroupQueueProcessor<ScenarioExecutionPayload>(
    {
      name: queueName,
      process: handler,
      options: {
        globalConcurrency: SCENARIO_EXECUTION_CONCURRENCY,
      },
      groupKey: (payload) => payload.scenarioRunId,
      score: (payload) => Date.now(),
      spanAttributes: (payload) => ({
        "scenario.id": payload.scenarioId,
        "scenario.run.id": payload.scenarioRunId,
        "batch.run.id": payload.batchRunId,
        "tenant.id": payload.projectId,
        "scenario.attempt": payload.attempt,
      }),
    },
    redis,
    { consumerEnabled: consumerEnabled ?? true },
  );
}
