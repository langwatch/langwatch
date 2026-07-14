import type { Event } from "../domain/types";
import { RecoverableError } from "../services/errorHandling";
import { CUTOFF_KEY_PREFIX, doneMarkerKey, isAtOrBeforeCutoffMarker } from "../replay/replayConstants";

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
/** Minimal Redis surface: a pipeline that batches the two marker reads. */
interface ReplayMarkerPipeline {
  hget(key: string, field: string): ReplayMarkerPipeline;
  get(key: string): ReplayMarkerPipeline;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}
interface ReplayMarkerRedis {
  pipeline(): ReplayMarkerPipeline;
}

export class RedisReplayMarkerChecker implements ReplayMarkerChecker {
  constructor(private readonly redis: ReplayMarkerRedis) {}

  async check(projectionName: string, event: Event): Promise<ReplayMarkerDecision> {
    const aggregateKey = `${String(event.tenantId)}:${event.aggregateType}:${String(event.aggregateId)}`;

    // Read the active cutoff marker (in-flight replay) and the short-TTL
    // terminal "done" marker (replay finished) in a single round-trip so the
    // common no-replay case stays one RTT (both absent → "process").
    const results = await this.redis
      .pipeline()
      .hget(`${CUTOFF_KEY_PREFIX}${projectionName}`, aggregateKey)
      .get(doneMarkerKey(projectionName, aggregateKey))
      .exec();

    const cutoff = (results?.[0]?.[1] ?? null) as string | null;
    const done = (results?.[1]?.[1] ?? null) as string | null;

    // Active replay for this aggregate takes precedence over a stale done marker.
    if (cutoff) {
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

    // Replay has finished rebuilding this aggregate (terminal marker still
    // within its TTL). Skip anything at/before the cutoff — replay already
    // wrote it, so a job staged but never active during the pause must not
    // re-run and double-write it — but let anything newer process live.
    if (done) {
      return isAtOrBeforeCutoffMarker(event.createdAt, event.id, done)
        ? "skip"
        : "process";
    }

    return "process";
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
