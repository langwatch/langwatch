import { nowInstant } from "@langwatch/time";

import type { DiscoveredAggregate } from "./replayEventSource.ts";
import type { ReplayRedis } from "./replayRedis.ts";
import type { ProjectionKind } from "./types.ts";

/**
 * The GroupQueue's global key prefix. All event-sourcing jobs share one queue
 * named `{event-sourcing/jobs}`, so the Redis key prefix is:
 */
const GQ_KEY_PREFIX = "{event-sourcing/jobs}:gq:";

/**
 * Fold groupIds are always `${tenantId}/fold/${name}/${aggregateType}:${aggregateId}`,
 * so they can be reconstructed exactly from the discovered aggregates.
 */
function foldGroupActiveKey({
  tenantId,
  projectionName,
  aggregateType,
  aggregateId,
}: {
  tenantId: string;
  projectionName: string;
  aggregateType: string;
  aggregateId: string;
}): string {
  const groupId = `${tenantId}/fold/${projectionName}/${aggregateType}:${aggregateId}`;
  return `${GQ_KEY_PREFIX}group:${groupId}:active`;
}

/**
 * Map/state groupIds may end in a projection-defined key that can't be
 * reconstructed from discovered aggregates, so drain by scanning below the
 * job-path prefix; fold groups use the exact-key path above and skip this scan.
 */
async function hasActiveGroups({
  redis,
  tenantIds,
  projectionName,
  scannedGroupPath,
}: {
  redis: ReplayRedis;
  tenantIds: Iterable<string>;
  projectionName: string;
  /** Fold groups are checked directly; only these custom-key lanes need a scan. */
  scannedGroupPath: "map" | "state";
}): Promise<boolean> {
  for (const tenantId of tenantIds) {
    const pattern = `${GQ_KEY_PREFIX}group:${tenantId}/${scannedGroupPath}/${projectionName}/*:active`;
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
      if (keys.length > 0) return true;
      cursor = nextCursor;
    } while (cursor !== "0");
  }
  return false;
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
  redis: ReplayRedis;
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
  redis: ReplayRedis;
  pauseKey: string;
}): Promise<void> {
  const pausedSetKey = `${GQ_KEY_PREFIX}paused-jobs`;
  await redis.srem(pausedSetKey, pauseKey);

  // Signal the dispatcher loop to wake up and re-evaluate paused groups
  const signalKey = `${GQ_KEY_PREFIX}signal`;
  await redis.lpush(signalKey, "1");
}

async function projectionDrained({
  redis,
  aggregates,
  tenantIds,
  projectionName,
  kind,
}: {
  redis: ReplayRedis;
  aggregates: DiscoveredAggregate[];
  tenantIds: Set<string>;
  projectionName: string;
  kind: ProjectionKind;
}): Promise<boolean> {
  if (kind === "map" || kind === "state") {
    const jobPath = kind === "map" ? "map" : "state";
    return !(await hasActiveGroups({
      redis,
      tenantIds,
      projectionName,
      scannedGroupPath: jobPath,
    }));
  }
  const pipeline = redis.pipeline();
  for (const agg of aggregates) {
    pipeline.get(
      foldGroupActiveKey({
        tenantId: agg.tenantId,
        projectionName,
        aggregateType: agg.aggregateType,
        aggregateId: agg.aggregateId,
      }),
    );
  }
  const results = await pipeline.exec();
  if (!results) {
    throw new Error(`Failed to inspect active jobs while draining projection ${projectionName}`);
  }
  return results.every(([_err, val]) => val === null);
}

/** No fold group of any listed projection holds an active job for these aggregates. */
async function foldGroupsDrainedAcross({
  redis,
  aggregates,
  foldProjections,
  projections,
}: {
  redis: ReplayRedis;
  aggregates: DiscoveredAggregate[];
  foldProjections: { projectionName: string; kind: ProjectionKind }[];
  projections: { projectionName: string; kind: ProjectionKind }[];
}): Promise<boolean> {
  if (foldProjections.length === 0) return true;
  const pipeline = redis.pipeline();
  for (const agg of aggregates) {
    for (const proj of foldProjections) {
      pipeline.get(
        foldGroupActiveKey({
          tenantId: agg.tenantId,
          projectionName: proj.projectionName,
          aggregateType: agg.aggregateType,
          aggregateId: agg.aggregateId,
        }),
      );
    }
  }
  const results = await pipeline.exec();
  const names = () => projections.map((p) => p.projectionName).join(", ");
  if (!results) {
    throw new Error(`Failed to inspect active jobs while draining projections [${names()}]`);
  }
  const commandErrors = results.filter(([err]) => err != null);
  if (commandErrors.length > 0) {
    throw new Error(
      `Failed to inspect active jobs while draining projections [${names()}]: ${commandErrors[0]![0]!.message}`,
    );
  }
  return results.every(([, val]) => val === null);
}

async function mapGroupsDrained({
  redis,
  tenantIds,
  mapProjections,
}: {
  redis: ReplayRedis;
  tenantIds: Set<string>;
  mapProjections: { projectionName: string; kind: ProjectionKind }[];
}): Promise<boolean> {
  for (const proj of mapProjections) {
    const active = await hasActiveGroups({
      redis,
      tenantIds,
      projectionName: proj.projectionName,
      scannedGroupPath: "map",
    });
    if (active) return false;
  }
  return true;
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
  redis: ReplayRedis;
  aggregates: DiscoveredAggregate[];
  projectionName: string;
  kind: ProjectionKind;
  maxWaitMs?: number;
}): Promise<void> {
  if (aggregates.length === 0) return;

  const tenantIds = new Set(aggregates.map((agg) => agg.tenantId));
  const start = nowInstant().epochMilliseconds;

  while (nowInstant().epochMilliseconds - start < maxWaitMs) {
    const allDrained = await projectionDrained({
      redis,
      aggregates,
      tenantIds,
      projectionName,
      kind,
    });
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
  redis: ReplayRedis;
  aggregates: DiscoveredAggregate[];
  projections: { projectionName: string; kind: ProjectionKind }[];
  maxWaitMs?: number;
}): Promise<void> {
  if (aggregates.length === 0 || projections.length === 0) return;

  const foldProjections = projections.filter((p) => p.kind === "fold");
  const mapProjections = projections.filter((p) => p.kind === "map");
  const tenantIds = new Set(aggregates.map((agg) => agg.tenantId));
  const start = nowInstant().epochMilliseconds;

  while (nowInstant().epochMilliseconds - start < maxWaitMs) {
    const foldsDrained = await foldGroupsDrainedAcross({
      redis,
      aggregates,
      foldProjections,
      projections,
    });
    const mapsDrained = await mapGroupsDrained({ redis, tenantIds, mapProjections });

    if (foldsDrained && mapsDrained) return;

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
