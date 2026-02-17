import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { connection } from "~/server/redis";
import { createLogger } from "~/utils/logger/server";
import type { Event } from "../domain/types";

const logger = createLogger("langwatch:event-sourcing:replay-marker-check");

/**
 * Error thrown when a fold projection event needs to be deferred because
 * projection-replay is active for this aggregate. BullMQ's retry mechanism
 * (fixed 2s backoff) serves as the deferral — the event will be retried
 * until the marker is removed.
 */
export class ReplayDeferralError extends Error {
  constructor(projectionName: string, aggregateKey: string, reason: string) {
    super(
      `projection-replay active for ${projectionName}:${aggregateKey}: ${reason}`,
    );
    this.name = "ReplayDeferralError";
  }
}

/**
 * Checks if projection-replay is active for a given aggregate.
 *
 * - "pending" marker: Cutoff is being recorded — defer all events (throw).
 * - EventId <= cutoff: Replay handles this event — skip (return).
 * - EventId > cutoff but marker exists: Replay still running — defer (throw).
 * - No marker: Normal processing — continue.
 *
 * Cost when no replay is active: single HGET returning null (~0.1ms).
 *
 * **EventId string comparison safety:** `event.id <= cutoff` is a lexicographic
 * comparison on full EventId strings. This is safe because both IDs share the
 * same aggregate prefix (tenantId:aggregateType:aggregateId) and the remaining
 * discriminator is a 13-digit millisecond timestamp (safe until year 2286),
 * so lexicographic order equals numeric order. This is consistent with the
 * ClickHouse replay tool which uses `max(EventId)` for cutoff and
 * `EventId <=` for filtering.
 */
export async function checkReplayMarker(
  redisConnection: IORedis | Cluster | undefined,
  projectionName: string,
  event: Event,
): Promise<void> {
  const redis = redisConnection ?? connection;

  if (!redis) {
    logger.warn(
      "No Redis connection available for replay marker check — skipping. " +
        "This is expected during build/test but should not happen in production.",
    );
    return;
  }

  const aggregateKey = `${String(event.tenantId)}:${event.aggregateType}:${String(event.aggregateId)}`;
  const cutoff = await redis.hget(
    `projection-replay:cutoff:${projectionName}`,
    aggregateKey,
  );

  if (!cutoff) return; // No marker — normal processing

  if (cutoff === "pending") {
    throw new ReplayDeferralError(
      projectionName,
      aggregateKey,
      "cutoff being recorded, deferring",
    );
  }

  if (event.id <= cutoff) {
    return; // Skip — replay script handles this event
  }

  // Event after cutoff but replay still running for this aggregate
  throw new ReplayDeferralError(
    projectionName,
    aggregateKey,
    "replay in progress, deferring event past cutoff",
  );
}
