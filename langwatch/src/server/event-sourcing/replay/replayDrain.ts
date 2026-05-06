import type IORedis from "ioredis";
import type { DiscoveredAggregate } from "./replayEventLoader";
import type { ProjectionKind } from "./types";

/**
 * The GroupQueue's global key prefix. All event-sourcing jobs share one queue
 * named `{event-sourcing/jobs}`, so the Redis key prefix is:
 */
const GQ_KEY_PREFIX = "{event-sourcing/jobs}:gq:";

/**
 * groupId path segment used by `QueueManager` when building groupKeys.
 * Folds use `fold/{name}`, maps use `map/{name}`.
 */
function groupSegment(kind: ProjectionKind): string {
  return kind === "fold" ? "fold" : "map";
}

/**
 * Pause a projection in the GroupQueue. The pauseKey is consumed by the
 * dispatcher Lua script, which matches it against `{pipeline}/{__jobType}/{name}`
 * — so callers must pass the pre-built pauseKey from the registered projection.
 */
export async function pauseProjection({
  redis,
  pauseKey,
}: {
  redis: IORedis;
  pauseKey: string;
}): Promise<void> {
  const pausedSetKey = `${GQ_KEY_PREFIX}paused-jobs`;
  await redis.sadd(pausedSetKey, pauseKey);
}

/**
 * Unpause a projection and signal the dispatcher to wake up.
 */
export async function unpauseProjection({
  redis,
  pauseKey,
}: {
  redis: IORedis;
  pauseKey: string;
}): Promise<void> {
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
  kind,
  maxWaitMs = 60_000,
}: {
  redis: IORedis;
  aggregates: DiscoveredAggregate[];
  projectionName: string;
  kind: ProjectionKind;
  maxWaitMs?: number;
}): Promise<void> {
  if (aggregates.length === 0) return;

  const segment = groupSegment(kind);
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const pipeline = redis.pipeline();
    for (const agg of aggregates) {
      const groupId = `${agg.tenantId}/${segment}/${projectionName}/${agg.aggregateType}:${agg.aggregateId}`;
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
  projections: Array<{ projectionName: string; kind: ProjectionKind }>;
  maxWaitMs?: number;
}): Promise<void> {
  if (aggregates.length === 0 || projections.length === 0) return;

  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const pipeline = redis.pipeline();
    for (const agg of aggregates) {
      for (const proj of projections) {
        const segment = groupSegment(proj.kind);
        const groupId = `${agg.tenantId}/${segment}/${proj.projectionName}/${agg.aggregateType}:${agg.aggregateId}`;
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

    const commandErrors = results.filter(([err]) => err != null);
    if (commandErrors.length > 0) {
      const names = projections.map((p) => p.projectionName).join(", ");
      throw new Error(
        `Failed to inspect active jobs while draining projections [${names}]: ${commandErrors[0]![0]!.message}`,
      );
    }

    const allDrained = results.every(([, val]) => val === null);
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
