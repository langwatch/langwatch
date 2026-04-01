import type IORedis from "ioredis";

/** Safety TTL for replay markers — prevents orphaned markers from permanently
 *  blocking live processing if a replay is abandoned without cleanup. */
const MARKER_TTL_SECONDS = 7 * 24 * 3600; // 7 days

function cutoffKey(projectionName: string): string {
  return `projection-replay:cutoff:${projectionName}`;
}

function completedKey(projectionName: string): string {
  return `projection-replay:completed:${projectionName}`;
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
  await pipeline.exec();
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
  await pipeline.exec();
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
  await pipeline.exec();
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
