import type IORedis from "ioredis";
import type { DiscoveredAggregate } from "./replayEventLoader";

/**
 * The GroupQueue's global key prefix. All event-sourcing jobs share one queue
 * named `{event-sourcing/jobs}`, so the Redis key prefix is:
 */
const GQ_KEY_PREFIX = "{event-sourcing/jobs}:gq:";

/**
 * Pause a specific fold projection in the GroupQueue.
 */
export async function pauseProjection({
  redis,
  pipelineName,
  projectionName,
}: {
  redis: IORedis;
  pipelineName: string;
  projectionName: string;
}): Promise<void> {
  const pauseKey = `${pipelineName}/projection/${projectionName}`;
  const pausedSetKey = `${GQ_KEY_PREFIX}paused-jobs`;
  await redis.sadd(pausedSetKey, pauseKey);
}

/**
 * Unpause a fold projection and signal the dispatcher to wake up.
 */
export async function unpauseProjection({
  redis,
  pipelineName,
  projectionName,
}: {
  redis: IORedis;
  pipelineName: string;
  projectionName: string;
}): Promise<void> {
  const pauseKey = `${pipelineName}/projection/${projectionName}`;
  const pausedSetKey = `${GQ_KEY_PREFIX}paused-jobs`;
  await redis.srem(pausedSetKey, pauseKey);

  // Signal the dispatcher loop to wake up and re-evaluate paused groups
  const signalKey = `${GQ_KEY_PREFIX}signal`;
  await redis.lpush(signalKey, "1");
}

/**
 * Wait until all active (in-flight) jobs for the given aggregates have completed.
 */
export async function waitForActiveJobs({
  redis,
  aggregates,
  projectionName,
  maxWaitMs = 60_000,
}: {
  redis: IORedis;
  aggregates: DiscoveredAggregate[];
  projectionName: string;
  maxWaitMs?: number;
}): Promise<void> {
  if (aggregates.length === 0) return;

  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const pipeline = redis.pipeline();
    for (const agg of aggregates) {
      const groupId = `${agg.tenantId}/fold/${projectionName}/${agg.aggregateType}:${agg.aggregateId}`;
      pipeline.get(`${GQ_KEY_PREFIX}group:${groupId}:active`);
    }
    const results = await pipeline.exec();
    if (!results) {
      throw new Error(
        `Failed to inspect active jobs while draining projection ${projectionName}`,
      );
    }

    const allDrained = results.every(([_err, val]) => val === null);
    if (allDrained) return;

    await sleep(200);
  }

  throw new Error(
    `Timed out waiting for active jobs to drain for projection ${projectionName} after ${maxWaitMs}ms`,
  );
}

/**
 * Wait until all active (in-flight) jobs across ALL specified projections have completed.
 * Checks every projection's group queues in a single polling loop.
 */
export async function waitForAllActiveJobs({
  redis,
  aggregates,
  projections,
  maxWaitMs = 60_000,
}: {
  redis: IORedis;
  aggregates: DiscoveredAggregate[];
  projections: Array<{ projectionName: string }>;
  maxWaitMs?: number;
}): Promise<void> {
  if (aggregates.length === 0 || projections.length === 0) return;

  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const pipeline = redis.pipeline();
    for (const agg of aggregates) {
      for (const proj of projections) {
        const groupId = `${agg.tenantId}/fold/${proj.projectionName}/${agg.aggregateType}:${agg.aggregateId}`;
        pipeline.get(`${GQ_KEY_PREFIX}group:${groupId}:active`);
      }
    }
    const results = await pipeline.exec();
    if (!results) {
      const names = projections.map((p) => p.projectionName).join(", ");
      throw new Error(
        `Failed to inspect active jobs while draining projections [${names}]`,
      );
    }

    const allDrained = results.every(([_err, val]) => val === null);
    if (allDrained) return;

    await sleep(200);
  }

  const names = projections.map((p) => p.projectionName).join(", ");
  throw new Error(
    `Timed out waiting for active jobs to drain for projections [${names}] after ${maxWaitMs}ms`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
