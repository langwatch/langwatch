import type IORedis from "ioredis";
import { CUTOFF_KEY_PREFIX, COMPLETED_KEY_PREFIX, MARKER_TTL_SECONDS } from "./replayConstants";

/** Throw if any command in a pipeline result has an error. */
function checkPipelineErrors(results: [error: Error | null, result: unknown][] | null, operation: string): void {
  if (!results) throw new Error(`Pipeline returned null during ${operation}`);
  for (const [err] of results) {
    if (err) throw new Error(`Pipeline command failed during ${operation}: ${err.message}`);
  }
}

function cutoffKey(projectionName: string): string {
  return `${CUTOFF_KEY_PREFIX}${projectionName}`;
}

function completedKey(projectionName: string): string {
  return `${COMPLETED_KEY_PREFIX}${projectionName}`;
}

export function aggregateKey({
  tenantId,
  aggregateType,
  aggregateId,
}: {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
}): string {
  return `${tenantId}:${aggregateType}:${aggregateId}`;
}

/** Pipeline HSET "pending" for a batch of aggregate keys. */
export async function markPendingBatch({
  redis,
  projectionName,
  aggKeys,
}: {
  redis: IORedis;
  projectionName: string;
  aggKeys: string[];
}): Promise<void> {
  if (aggKeys.length === 0) return;
  const pipeline = redis.pipeline();
  const key = cutoffKey(projectionName);
  for (const aggKey of aggKeys) {
    pipeline.hset(key, aggKey, "pending");
  }
  pipeline.expire(key, MARKER_TTL_SECONDS);
  const markResults = await pipeline.exec();
  checkPipelineErrors(markResults, "markPendingBatch");
}

/**
 * Pipeline HSET cutoff markers for a batch of aggregate keys.
 * Marker format: `{timestamp}:{eventId}` — matches the comparison in
 * ReplayMarkerChecker which uses (timestamp, eventId) ordering.
 */
export async function markCutoffBatch({
  redis,
  projectionName,
  cutoffs,
}: {
  redis: IORedis;
  projectionName: string;
  cutoffs: Map<string, { timestamp: number; eventId: string }>;
}): Promise<void> {
  if (cutoffs.size === 0) return;
  const pipeline = redis.pipeline();
  const key = cutoffKey(projectionName);
  for (const [aggKey, cutoff] of cutoffs) {
    pipeline.hset(key, aggKey, `${cutoff.timestamp}:${cutoff.eventId}`);
  }
  pipeline.expire(key, MARKER_TTL_SECONDS);
  const cutoffResults = await pipeline.exec();
  checkPipelineErrors(cutoffResults, "markCutoffBatch");
}

/** Pipeline HDEL + SADD for a batch of aggregate keys. */
export async function unmarkBatch({
  redis,
  projectionName,
  aggKeys,
}: {
  redis: IORedis;
  projectionName: string;
  aggKeys: string[];
}): Promise<void> {
  if (aggKeys.length === 0) return;
  const pipeline = redis.pipeline();
  const cKey = cutoffKey(projectionName);
  const compKey = completedKey(projectionName);
  for (const aggKey of aggKeys) {
    pipeline.hdel(cKey, aggKey);
    pipeline.sadd(compKey, aggKey);
  }
  const unmarkResults = await pipeline.exec();
  checkPipelineErrors(unmarkResults, "unmarkBatch");
}

/** Get the set of completed aggregate keys for a projection. */
export async function getCompletedSet({
  redis,
  projectionName,
}: {
  redis: IORedis;
  projectionName: string;
}): Promise<Set<string>> {
  const members = await redis.smembers(completedKey(projectionName));
  return new Set(members);
}

/** Get all pending/cutoff markers for a projection. */
export async function getCutoffMarkers({
  redis,
  projectionName,
}: {
  redis: IORedis;
  projectionName: string;
}): Promise<Map<string, string>> {
  const all = await redis.hgetall(cutoffKey(projectionName));
  return new Map(Object.entries(all));
}

/** Remove a stale marker (crashed mid-replay). */
export async function removeStaleMarker({
  redis,
  projectionName,
  aggKey,
}: {
  redis: IORedis;
  projectionName: string;
  aggKey: string;
}): Promise<void> {
  await redis.hdel(cutoffKey(projectionName), aggKey);
}

/** Final cleanup: remove both redis keys after full completion. */
export async function cleanupAll({
  redis,
  projectionName,
}: {
  redis: IORedis;
  projectionName: string;
}): Promise<void> {
  await redis.del(cutoffKey(projectionName));
  await redis.del(completedKey(projectionName));
}

/** Check if a previous run exists (has completed or cutoff keys). */
export async function hasPreviousRun({
  redis,
  projectionName,
}: {
  redis: IORedis;
  projectionName: string;
}): Promise<{ completedCount: number; markerCount: number }> {
  const [completedCount, markerCount] = await Promise.all([
    redis.scard(completedKey(projectionName)),
    redis.hlen(cutoffKey(projectionName)),
  ]);
  return { completedCount, markerCount };
}

/** Pipeline HSET "pending" for a batch of aggregate keys across ALL projections. */
export async function markPendingBatchMulti({
  redis,
  projectionNames,
  aggKeys,
}: {
  redis: IORedis;
  projectionNames: string[];
  aggKeys: string[];
}): Promise<void> {
  if (aggKeys.length === 0 || projectionNames.length === 0) return;
  const pipeline = redis.pipeline();
  for (const projName of projectionNames) {
    const key = cutoffKey(projName);
    for (const aggKey of aggKeys) {
      pipeline.hset(key, aggKey, "pending");
    }
    pipeline.expire(key, MARKER_TTL_SECONDS);
  }
  const results = await pipeline.exec();
  checkPipelineErrors(results, "markPendingBatchMulti");
}

/** Pipeline HSET cutoff markers for a batch of aggregate keys across ALL projections. */
export async function markCutoffBatchMulti({
  redis,
  projectionNames,
  cutoffs,
}: {
  redis: IORedis;
  projectionNames: string[];
  cutoffs: Map<string, { timestamp: number; eventId: string }>;
}): Promise<void> {
  if (cutoffs.size === 0 || projectionNames.length === 0) return;
  const pipeline = redis.pipeline();
  for (const projName of projectionNames) {
    const key = cutoffKey(projName);
    for (const [aggKey, cutoff] of cutoffs) {
      pipeline.hset(key, aggKey, `${cutoff.timestamp}:${cutoff.eventId}`);
    }
    pipeline.expire(key, MARKER_TTL_SECONDS);
  }
  const results = await pipeline.exec();
  checkPipelineErrors(results, "markCutoffBatchMulti");
}

/** Pipeline HDEL + SADD for a batch of aggregate keys across ALL projections. */
export async function unmarkBatchMulti({
  redis,
  projectionNames,
  aggKeys,
}: {
  redis: IORedis;
  projectionNames: string[];
  aggKeys: string[];
}): Promise<void> {
  if (aggKeys.length === 0 || projectionNames.length === 0) return;
  const pipeline = redis.pipeline();
  for (const projName of projectionNames) {
    const cKey = cutoffKey(projName);
    const compKey = completedKey(projName);
    for (const aggKey of aggKeys) {
      pipeline.hdel(cKey, aggKey);
      pipeline.sadd(compKey, aggKey);
    }
  }
  const results = await pipeline.exec();
  checkPipelineErrors(results, "unmarkBatchMulti");
}
