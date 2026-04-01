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
    if (!results) break;

    const allDrained = results.every(([_err, val]) => val === null);
    if (allDrained) return;

    await sleep(200);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
