import { nowEpochMs } from "@langwatch/time";

import {
  EVENT_SOURCING_QUEUE_KEY_NAME,
  type ReplayClaimsIndex,
  ReplayClaimsIndexNotReadyError,
} from "./replayClaimsIndex.ts";
import type { DiscoveredAggregate } from "./replayEventSource.ts";
import type { ReplayRedis, ReplayRedisPipeline } from "./replayRedis.ts";
import type { ProjectionKind } from "./types.ts";

/**
 * The GroupQueue's global key prefix. All event-sourcing jobs share one queue
 * named `{event-sourcing/jobs}`, so the Redis key prefix is:
 */
const GQ_KEY_PREFIX = `${EVENT_SOURCING_QUEUE_KEY_NAME}:gq:`;

/**
 * Fold groupIds are always `${tenantId}/fold/${name}/${aggregateType}:${aggregateId}`,
 * so they can be reconstructed exactly from the discovered aggregates.
 */
function foldGroupKey({
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
  return `${GQ_KEY_PREFIX}group:${groupId}`;
}

/** Queues the fold group's active key and its claimed record's token: null for both is idle. */
function queueFoldGroupChecks({
  pipeline,
  groupKey,
}: {
  pipeline: ReplayRedisPipeline;
  groupKey: string;
}): void {
  pipeline.get(`${groupKey}:active`);
  pipeline.hget(`${groupKey}:claimed`, "token");
}

/**
 * Map/state groupIds may end in a projection-defined key that can't be rebuilt from the
 * discovered aggregates, so the queue lists each tenant's claimed groups and the drain asks it;
 * walking the keyspace here took half of Redis's CPU (ADR-092).
 */
async function hasActiveGroups({
  claims,
  tenantIds,
  projectionName,
  groupPath,
}: {
  claims: ReplayClaimsIndex;
  tenantIds: Iterable<string>;
  projectionName: string;
  groupPath: "map" | "state";
}): Promise<boolean> {
  for (const tenantId of tenantIds) {
    const groupIdPrefix = `${tenantId}/${groupPath}/${projectionName}/`;
    if ((await claims.claimedGroups({ tenantId, groupIdPrefix })).length > 0) return true;
  }
  return false;
}

/** The index is trusted only when ready; otherwise the batch fails rather than report drained. */
async function assertClaimsIndexReady({ claims }: { claims: ReplayClaimsIndex }): Promise<void> {
  if (!(await claims.isReady())) throw new ReplayClaimsIndexNotReadyError();
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
  claims,
  aggregates,
  tenantIds,
  projectionName,
  kind,
}: {
  redis: ReplayRedis;
  claims: ReplayClaimsIndex;
  aggregates: DiscoveredAggregate[];
  tenantIds: Set<string>;
  projectionName: string;
  kind: ProjectionKind;
}): Promise<boolean> {
  if (kind === "map" || kind === "state") {
    return !(await hasActiveGroups({ claims, tenantIds, projectionName, groupPath: kind }));
  }
  const pipeline = redis.pipeline();
  for (const agg of aggregates) {
    queueFoldGroupChecks({
      pipeline,
      groupKey: foldGroupKey({
        tenantId: agg.tenantId,
        projectionName,
        aggregateType: agg.aggregateType,
        aggregateId: agg.aggregateId,
      }),
    });
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
      queueFoldGroupChecks({
        pipeline,
        groupKey: foldGroupKey({
          tenantId: agg.tenantId,
          projectionName: proj.projectionName,
          aggregateType: agg.aggregateType,
          aggregateId: agg.aggregateId,
        }),
      });
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
  claims,
  tenantIds,
  mapProjections,
}: {
  claims: ReplayClaimsIndex;
  tenantIds: Set<string>;
  mapProjections: { projectionName: string; kind: ProjectionKind }[];
}): Promise<boolean> {
  for (const proj of mapProjections) {
    const active = await hasActiveGroups({
      claims,
      tenantIds,
      projectionName: proj.projectionName,
      groupPath: "map",
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
  claims,
  aggregates,
  projectionName,
  kind,
  maxWaitMs = 60_000,
}: {
  redis: ReplayRedis;
  claims: ReplayClaimsIndex;
  aggregates: DiscoveredAggregate[];
  projectionName: string;
  kind: ProjectionKind;
  maxWaitMs?: number;
}): Promise<void> {
  if (aggregates.length === 0) return;
  if (kind !== "fold") await assertClaimsIndexReady({ claims });

  const tenantIds = new Set(aggregates.map((agg) => agg.tenantId));
  const start = nowEpochMs();

  while (nowEpochMs() - start < maxWaitMs) {
    const allDrained = await projectionDrained({
      redis,
      claims,
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
  claims,
  aggregates,
  projections,
  maxWaitMs = 60_000,
}: {
  redis: ReplayRedis;
  claims: ReplayClaimsIndex;
  aggregates: DiscoveredAggregate[];
  projections: { projectionName: string; kind: ProjectionKind }[];
  maxWaitMs?: number;
}): Promise<void> {
  if (aggregates.length === 0 || projections.length === 0) return;

  const foldProjections = projections.filter((p) => p.kind === "fold");
  const mapProjections = projections.filter((p) => p.kind === "map");
  const tenantIds = new Set(aggregates.map((agg) => agg.tenantId));
  if (mapProjections.length > 0) await assertClaimsIndexReady({ claims });
  const start = nowEpochMs();

  while (nowEpochMs() - start < maxWaitMs) {
    const foldsDrained = await foldGroupsDrainedAcross({
      redis,
      aggregates,
      foldProjections,
      projections,
    });
    const mapsDrained = await mapGroupsDrained({ claims, tenantIds, mapProjections });

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
