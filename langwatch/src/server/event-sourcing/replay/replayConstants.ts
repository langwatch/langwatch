/** Redis key prefix for cutoff markers: `projection-replay:cutoff:{projectionName}` */
export const CUTOFF_KEY_PREFIX = "projection-replay:cutoff:";

/** Redis key prefix for completed sets: `projection-replay:completed:{projectionName}` */
export const COMPLETED_KEY_PREFIX = "projection-replay:completed:";

/** Safety TTL for replay markers (7 days) — prevents orphaned markers from
 *  permanently blocking live processing if a replay is abandoned. */
export const MARKER_TTL_SECONDS = 7 * 24 * 3600;

/**
 * Redis key prefix for terminal "done" markers, one string key per aggregate:
 * `projection-replay:done:{projectionName}:{aggregateKey}` → `{timestamp}:{eventId}`.
 *
 * Written when replay finishes rebuilding an aggregate (see markCompletedBatch)
 * and read by the live checker alongside the active cutoff marker. Semantics:
 *   - active cutoff hash `"pending"`      → defer every event
 *   - active cutoff hash `"{ts}:{eventId}"` → replay in flight: skip ≤ cutoff, defer > cutoff
 *   - done key `"{ts}:{eventId}"`         → replay finished: skip ≤ cutoff, PROCESS > cutoff
 *   - neither                             → process
 *
 * Kept as a short-TTL key (not left in the cutoff hash) so a giant all-tenant
 * replay does not retain a marker per aggregate for its whole duration — the
 * cutoff hash stays bounded to in-flight aggregates and done markers self-expire.
 */
export const DONE_KEY_PREFIX = "projection-replay:done:";

/**
 * TTL for terminal done markers. Long enough to cover a job that was staged
 * (queued but never active) during a batch's replay pause and only drains after
 * unpause; short enough that done-marker memory stays bounded to roughly
 * (replay throughput × this window) rather than the whole run's aggregate count.
 */
export const DONE_MARKER_TTL_SECONDS = 15 * 60;

/** Per-aggregate done-marker key: `projection-replay:done:{projectionName}:{aggregateKey}`. */
export function doneMarkerKey(projectionName: string, aggregateKey: string): string {
  return `${DONE_KEY_PREFIX}${projectionName}:${aggregateKey}`;
}

/**
 * Compares an event against a cutoff using the same ordering as ClickHouse:
 * `EventTimestamp ASC, EventId ASC`.
 *
 * Returns true if the event is at or before the cutoff (replay handles it).
 */
export function isAtOrBeforeCutoff(
  eventTimestamp: number,
  eventId: string,
  cutoffTimestamp: number,
  cutoffEventId: string,
): boolean {
  if (eventTimestamp < cutoffTimestamp) return true;
  if (eventTimestamp > cutoffTimestamp) return false;
  return eventId <= cutoffEventId;
}

/**
 * Parses a cutoff marker string (`{timestamp}:{eventId}`) and compares
 * against an event. Returns true if the event is at or before the cutoff.
 *
 * Returns false for malformed markers (missing colon).
 */
export function isAtOrBeforeCutoffMarker(
  eventTimestamp: number,
  eventId: string,
  cutoffMarker: string,
): boolean {
  const colonIdx = cutoffMarker.indexOf(":");
  if (colonIdx === -1) return false;

  const cutoffTimestamp = parseInt(cutoffMarker.slice(0, colonIdx), 10);
  const cutoffEventId = cutoffMarker.slice(colonIdx + 1);

  if (!Number.isFinite(cutoffTimestamp) || cutoffEventId.length === 0) {
    return false; // Corrupted marker
  }

  return isAtOrBeforeCutoff(eventTimestamp, eventId, cutoffTimestamp, cutoffEventId);
}
