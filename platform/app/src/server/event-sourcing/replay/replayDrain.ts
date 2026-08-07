import type IORedis from "ioredis";
import type { DiscoveredAggregate } from "./replayEventLoader";
import type { ProjectionKind } from "./types";

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
 * Map and state groupIds may end in a projection-defined key, which cannot be
 * reconstructed from discovered aggregates. Drain those lanes by scanning for
 * any active group below their job-path prefix. Fold groups use the exact-key
 * path above and intentionally never enter this scan.
 */
async function hasActiveGroups({
  redis,
  tenantIds,
  projectionName,
  scannedGroupPath,
}: {
  redis: IORedis;
  tenantIds: Iterable<string>;
  projectionName: string;
  /** Fold groups are checked directly; only these custom-key lanes need a scan. */
  scannedGroupPath: "map" | "state";
}): Promise<boolean> {
  for (const tenantId of tenantIds) {
    const pattern = `${GQ_KEY_PREFIX}group:${tenantId}/${scannedGroupPath}/${projectionName}/*:active`;
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        500,
      );
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

async function isProjectionDrained({
  redis,
  tenantIds,
  aggregates,
  projectionName,
  kind,
}: {
  redis: IORedis;
  tenantIds: Iterable<string>;
  aggregates: DiscoveredAggregate[];
  projectionName: string;
  kind: ProjectionKind;
}): Promise<boolean> {
  if (kind === "map" || kind === "state") {
    return !(await hasActiveGroups({
      redis,
      tenantIds,
      projectionName,
      scannedGroupPath: kind === "map" ? "map" : "state",
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
    throw new Error(
      `Failed to inspect active jobs while draining projection ${projectionName}`,
    );
  }
  return results.every(([_err, val]) => val === null);
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

  const tenantIds = new Set(aggregates.map((agg) => agg.tenantId));
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const allDrained = await isProjectionDrained({
      redis,
      tenantIds,
      aggregates,
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

async function areFoldProjectionsDrained({
  redis,
  aggregates,
  foldProjections,
  allProjectionNames,
}: {
  redis: IORedis;
  aggregates: DiscoveredAggregate[];
  foldProjections: Array<{ projectionName: string; kind: ProjectionKind }>;
  allProjectionNames: string[];
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
  if (!results) {
    throw new Error(
      `Failed to inspect active jobs while draining projections [${allProjectionNames.join(", ")}]`,
    );
  }

  const commandErrors = results.filter(([err]) => err != null);
  if (commandErrors.length > 0) {
    throw new Error(
      `Failed to inspect active jobs while draining projections [${allProjectionNames.join(", ")}]: ${commandErrors[0]![0]!.message}`,
    );
  }

  return results.every(([, val]) => val === null);
}

async function areMapProjectionsDrained({
  redis,
  tenantIds,
  mapProjections,
}: {
  redis: IORedis;
  tenantIds: Iterable<string>;
  mapProjections: Array<{ projectionName: string; kind: ProjectionKind }>;
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

  const foldProjections = projections.filter((p) => p.kind === "fold");
  const mapProjections = projections.filter((p) => p.kind === "map");
  const allProjectionNames = projections.map((p) => p.projectionName);
  const tenantIds = new Set(aggregates.map((agg) => agg.tenantId));
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const foldsDrained = await areFoldProjectionsDrained({
      redis,
      aggregates,
      foldProjections,
      allProjectionNames,
    });
    const mapsDrained = await areMapProjectionsDrained({
      redis,
      tenantIds,
      mapProjections,
    });

    if (foldsDrained && mapsDrained) return;

    await sleep(200);
  }

  throw new Error(
    `Timed out waiting for active jobs to drain for projections [${allProjectionNames.join(", ")}] after ${maxWaitMs}ms`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
