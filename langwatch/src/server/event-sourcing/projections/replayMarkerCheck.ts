import type { Event } from "../domain/types";
import { RecoverableError } from "../services/errorHandling";
import { CUTOFF_KEY_PREFIX, isAtOrBeforeCutoffMarker } from "../replay/replayConstants";

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

/** Outcome of a replay marker check. */
export type ReplayMarkerDecision = "process" | "skip";

/**
 * Interface for checking replay markers. Implementations determine
 * how markers are stored and looked up.
 */
export interface ReplayMarkerChecker {
  /**
   * Check if projection-replay is active for the given event.
   *
   * Returns:
   * - `"process"` → no replay active, continue normal fold processing.
   * - `"skip"` → event is at or before the cutoff, replay handles it.
   * - throws `ReplayDeferralError` → "pending" or event is after cutoff, defer.
   *
   * Cost when no replay is active: single HGET returning null (~0.1ms).
   */
  check(projectionName: string, event: Event): Promise<ReplayMarkerDecision>;
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

  async check(projectionName: string, event: Event): Promise<ReplayMarkerDecision> {
    const aggregateKey = `${String(event.tenantId)}:${event.aggregateType}:${String(event.aggregateId)}`;
    const cutoff = await this.redis.hget(
      `${CUTOFF_KEY_PREFIX}${projectionName}`,
      aggregateKey,
    );

    if (!cutoff) return "process";

    if (cutoff === "pending") {
      throw new ReplayDeferralError(
        projectionName,
        aggregateKey,
        "cutoff being recorded, deferring",
      );
    }

    if (isAtOrBeforeCutoffMarker(event.createdAt, event.id, cutoff)) {
      return "skip";
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
  async check(_projectionName: string, _event: Event): Promise<ReplayMarkerDecision> {
    return "process";
  }
}
