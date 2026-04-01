/** Redis key prefix for cutoff markers: `projection-replay:cutoff:{projectionName}` */
export const CUTOFF_KEY_PREFIX = "projection-replay:cutoff:";

/** Redis key prefix for completed sets: `projection-replay:completed:{projectionName}` */
export const COMPLETED_KEY_PREFIX = "projection-replay:completed:";

/** Safety TTL for replay markers (7 days) — prevents orphaned markers from
 *  permanently blocking live processing if a replay is abandoned. */
export const MARKER_TTL_SECONDS = 7 * 24 * 3600;

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

  return isAtOrBeforeCutoff(eventTimestamp, eventId, cutoffTimestamp, cutoffEventId);
}
