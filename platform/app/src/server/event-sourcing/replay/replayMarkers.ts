import type IORedis from "ioredis";
import {
  COMPLETED_KEY_PREFIX,
  CUTOFF_KEY_PREFIX,
  DONE_MARKER_TTL_SECONDS,
  doneMarkerKey,
  MARKER_TTL_SECONDS,
} from "./replayConstants";
import type { ReplayLogWriter } from "./replayLog";

/** Throw if any command in a pipeline result has an error. */
function checkPipelineErrors(
  results: [error: Error | null, result: unknown][] | null,
  operation: string,
): void {
  if (!results) throw new Error(`Pipeline returned null during ${operation}`);
  for (const [err] of results) {
    if (err)
      throw new Error(
        `Pipeline command failed during ${operation}: ${err.message}`,
      );
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

/**
 * Terminal transition for replayed aggregates. For each aggregate: drop its
 * active cutoff marker from the cutoff hash, write a separate short-TTL "done"
 * marker preserving the cutoff boundary, and record it in the completed set.
 *
 * Unlike {@link unmarkBatch} (which HDELs the marker, returning the aggregate to
 * unconditional live processing), this PRESERVES the cutoff boundary. A job that
 * was staged — but never active — during the replay pause is not drained by
 * `waitForActiveJobs`; after unpause it runs, and without the boundary it would
 * re-process events at/before the cutoff and double-write records replay just
 * rebuilt (and re-fire map subscribers). The done-marker keeps the live checker
 * skipping those events while still letting genuinely newer events through.
 *
 * The boundary lives in its own short-TTL key rather than in the cutoff hash so
 * a giant (all-tenant, multi-month) replay does not retain a marker per
 * aggregate for its whole duration: the cutoff hash stays bounded to in-flight
 * aggregates and done markers self-expire after {@link DONE_MARKER_TTL_SECONDS}.
 */
export async function markCompletedBatch({
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
  const cKey = cutoffKey(projectionName);
  const compKey = completedKey(projectionName);
  for (const [aggKey, cutoff] of cutoffs) {
    pipeline.hdel(cKey, aggKey);
    pipeline.set(
      doneMarkerKey(projectionName, aggKey),
      `${cutoff.timestamp}:${cutoff.eventId}`,
      "EX",
      DONE_MARKER_TTL_SECONDS,
    );
    pipeline.sadd(compKey, aggKey);
  }
  const results = await pipeline.exec();
  checkPipelineErrors(results, "markCompletedBatch");
}

/**
 * Failure-path cleanup: HDEL a batch of aggregate keys from each projection's
 * cutoff hash WITHOUT adding them to the completed set (unlike
 * {@link unmarkBatch}) and WITHOUT touching done markers. Used when a batch
 * errors (or a cancellation abandons it) mid-flight: its aggregates were never
 * replayed, so their pending/cutoff markers must go — returning them to
 * unconditional live processing, matching their pre-replay state — while done
 * markers and completed-set entries from previously completed batches survive
 * so an operator re-run still skips those aggregates.
 */
export async function removeInFlightMarkers({
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
    pipeline.hdel(cutoffKey(projName), ...aggKeys);
  }
  const results = await pipeline.exec();
  checkPipelineErrors(results, "removeInFlightMarkers");
}

/**
 * Best-effort wrapper around {@link removeInFlightMarkers} for a batch that
 * errored (or was abandoned by cancellation) mid-flight. Never throws: a
 * marker-cleanup failure is logged and must not mask the original batch error.
 */
export async function clearFailedBatchMarkers({
  redis,
  projectionNames,
  aggKeys,
  log,
}: {
  redis: IORedis;
  projectionNames: string[];
  aggKeys: string[];
  log: ReplayLogWriter;
}): Promise<void> {
  try {
    await removeInFlightMarkers({
      redis,
      projectionNames,
      aggKeys,
    });
  } catch (cleanupError) {
    log.write({
      step: "error",
      error: `failed to clear replay markers for failed batch: ${
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError)
      }`,
    });
  }
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

/**
 * One pipeline covering every projection's "pending" markers for a batch.
 * Each projection carries only the aggregate keys whose event types it
 * declares — never the full cross product.
 */
export async function markPendingForProjections({
  redis,
  aggKeysByProjection,
}: {
  redis: IORedis;
  aggKeysByProjection: Map<string, string[]>;
}): Promise<void> {
  const pipeline = redis.pipeline();
  let commands = 0;
  for (const [projName, aggKeys] of aggKeysByProjection) {
    if (aggKeys.length === 0) continue;
    const key = cutoffKey(projName);
    for (const aggKey of aggKeys) {
      pipeline.hset(key, aggKey, "pending");
    }
    pipeline.expire(key, MARKER_TTL_SECONDS);
    commands++;
  }
  if (commands === 0) return;
  const results = await pipeline.exec();
  checkPipelineErrors(results, "markPendingForProjections");
}

/** One pipeline covering every projection's cutoff markers for a batch. */
export async function markCutoffForProjections({
  redis,
  cutoffsByProjection,
}: {
  redis: IORedis;
  cutoffsByProjection: Map<
    string,
    Map<string, { timestamp: number; eventId: string }>
  >;
}): Promise<void> {
  const pipeline = redis.pipeline();
  let commands = 0;
  for (const [projName, cutoffs] of cutoffsByProjection) {
    if (cutoffs.size === 0) continue;
    const key = cutoffKey(projName);
    for (const [aggKey, cutoff] of cutoffs) {
      pipeline.hset(key, aggKey, `${cutoff.timestamp}:${cutoff.eventId}`);
    }
    pipeline.expire(key, MARKER_TTL_SECONDS);
    commands++;
  }
  if (commands === 0) return;
  const results = await pipeline.exec();
  checkPipelineErrors(results, "markCutoffForProjections");
}

/**
 * One pipeline covering every projection's terminal transition for a batch —
 * the multi-projection form of {@link markCompletedBatch}, with the same
 * done-marker semantics per aggregate.
 */
export async function markCompletedForProjections({
  redis,
  cutoffsByProjection,
}: {
  redis: IORedis;
  cutoffsByProjection: Map<
    string,
    Map<string, { timestamp: number; eventId: string }>
  >;
}): Promise<void> {
  const pipeline = redis.pipeline();
  let commands = 0;
  for (const [projName, cutoffs] of cutoffsByProjection) {
    if (cutoffs.size === 0) continue;
    const cKey = cutoffKey(projName);
    const compKey = completedKey(projName);
    for (const [aggKey, cutoff] of cutoffs) {
      pipeline.hdel(cKey, aggKey);
      pipeline.set(
        doneMarkerKey(projName, aggKey),
        `${cutoff.timestamp}:${cutoff.eventId}`,
        "EX",
        DONE_MARKER_TTL_SECONDS,
      );
      pipeline.sadd(compKey, aggKey);
    }
    commands++;
  }
  if (commands === 0) return;
  const results = await pipeline.exec();
  checkPipelineErrors(results, "markCompletedForProjections");
}

/**
 * One pipeline covering every projection's no-event unmark for a batch — the
 * multi-projection form of {@link unmarkBatch} (HDEL + completed-set SADD).
 */
export async function unmarkForProjections({
  redis,
  aggKeysByProjection,
}: {
  redis: IORedis;
  aggKeysByProjection: Map<string, string[]>;
}): Promise<void> {
  const pipeline = redis.pipeline();
  let commands = 0;
  for (const [projName, aggKeys] of aggKeysByProjection) {
    if (aggKeys.length === 0) continue;
    const cKey = cutoffKey(projName);
    const compKey = completedKey(projName);
    for (const aggKey of aggKeys) {
      pipeline.hdel(cKey, aggKey);
      pipeline.sadd(compKey, aggKey);
    }
    commands++;
  }
  if (commands === 0) return;
  const results = await pipeline.exec();
  checkPipelineErrors(results, "unmarkForProjections");
}

/** Fetch every projection's completed set in one pipeline of SMEMBERS. */
export async function getCompletedSets({
  redis,
  projectionNames,
}: {
  redis: IORedis;
  projectionNames: string[];
}): Promise<Map<string, Set<string>>> {
  const sets = new Map<string, Set<string>>();
  if (projectionNames.length === 0) return sets;
  const pipeline = redis.pipeline();
  for (const projName of projectionNames) {
    pipeline.smembers(completedKey(projName));
  }
  const results = await pipeline.exec();
  checkPipelineErrors(results, "getCompletedSets");
  projectionNames.forEach((projName, i) => {
    const members = (results?.[i]?.[1] ?? []) as string[];
    sets.set(projName, new Set(members));
  });
  return sets;
}
