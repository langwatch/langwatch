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
   * - EventId <= cutoff → skip (resolve, replay handles it).
   * - EventId > cutoff → throw ReplayDeferralError (defer until replay done).
   *
   * Cost when no replay is active: single HGET returning null (~0.1ms).
   */
  check(projectionName: string, event: Event): Promise<void>;
}

/**
 * Redis-backed replay marker checker. Uses HGET on
 * `projection-replay:cutoff:{projectionName}` to coordinate with the replay CLI.
 *
 * **EventId string comparison safety:** `event.id <= cutoff` is a lexicographic
 * comparison on full EventId strings. Both IDs share the same aggregate prefix
 * (tenantId:aggregateType:aggregateId) and the remaining discriminator is a
 * 13-digit millisecond timestamp, so lexicographic order equals numeric order.
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

    if (event.id <= cutoff) {
      return; // Skip — replay script handles this event
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
