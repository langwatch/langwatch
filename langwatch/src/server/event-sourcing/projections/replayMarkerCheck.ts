import type { Event } from "../domain/types";
import { RecoverableError } from "../services/errorHandling";

/**
 * Thrown when a fold projection event must be deferred because projection-replay
 * is active for this aggregate. Extends RecoverableError so the GroupQueue's
 * retry mechanism re-stages the job with exponential backoff.
 */
export class ReplayDeferralError extends RecoverableError {
  constructor(projectionName: string, aggregateKey: string, reason: string) {
    super(
      `projection-replay active for ${projectionName}:${aggregateKey}: ${reason}`,
      { projectionName, aggregateKey },
    );
    this.name = "ReplayDeferralError";
  }
}

/**
 * Interface for checking replay markers. Implementations determine
 * how markers are stored and looked up.
 */
export interface ReplayMarkerChecker {
  /**
   * Check if projection-replay is active for the given event.
   *
   * - No marker → normal processing (resolve).
   * - "pending" → throw ReplayDeferralError (cutoff being recorded).
   * - Event at or before cutoff → skip (resolve, replay handles it).
   * - Event after cutoff → throw ReplayDeferralError (defer until replay done).
   *
   * Cost when no replay is active: single HGET returning null (~0.1ms).
   */
  check(projectionName: string, event: Event): Promise<void>;
}

/**
 * Compares an event against a cutoff using the same ordering as ClickHouse:
 * `EventTimestamp ASC, EventId ASC`.
 *
 * Returns true if the event is at or before the cutoff (replay handles it).
 *
 * Cutoff marker format: `{timestamp}:{eventId}` (colon-separated).
 */
function isAtOrBeforeCutoff(
  eventTimestamp: number,
  eventId: string,
  cutoffMarker: string,
): boolean {
  const colonIdx = cutoffMarker.indexOf(":");
  if (colonIdx === -1) return false; // Malformed marker

  const cutoffTimestamp = parseInt(cutoffMarker.slice(0, colonIdx), 10);
  const cutoffEventId = cutoffMarker.slice(colonIdx + 1);

  if (eventTimestamp < cutoffTimestamp) return true;
  if (eventTimestamp > cutoffTimestamp) return false;
  // Same timestamp — use EventId as tiebreaker (lexicographic, matching CH ORDER BY)
  return eventId <= cutoffEventId;
}

/**
 * Redis-backed replay marker checker. Uses HGET on
 * `projection-replay:cutoff:{projectionName}` to coordinate with the replay CLI.
 *
 * Cutoff marker format: `{timestamp}:{eventId}` — comparison mirrors the
 * ClickHouse `ORDER BY EventTimestamp ASC, EventId ASC` ordering so that
 * the boundary is consistent between the replay tool's CH queries and the
 * live event handler's Redis check.
 */
export class RedisReplayMarkerChecker implements ReplayMarkerChecker {
  constructor(
    private readonly redis: { hget(key: string, field: string): Promise<string | null> },
  ) {}

  async check(projectionName: string, event: Event): Promise<void> {
    const aggregateKey = `${String(event.tenantId)}:${event.aggregateType}:${String(event.aggregateId)}`;
    const cutoff = await this.redis.hget(
      `projection-replay:cutoff:${projectionName}`,
      aggregateKey,
    );

    if (!cutoff) return;

    if (cutoff === "pending") {
      throw new ReplayDeferralError(
        projectionName,
        aggregateKey,
        "cutoff being recorded, deferring",
      );
    }

    if (isAtOrBeforeCutoff(event.createdAt, event.id, cutoff)) {
      return; // Skip — replay handles this event
    }

    throw new ReplayDeferralError(
      projectionName,
      aggregateKey,
      "replay in progress, deferring event past cutoff",
    );
  }
}

/**
 * No-op implementation for tests and local development where no replay
 * coordination is needed. Always allows events through.
 */
export class NoopReplayMarkerChecker implements ReplayMarkerChecker {
  async check(_projectionName: string, _event: Event): Promise<void> {
    // No-op — always allow
  }
}
