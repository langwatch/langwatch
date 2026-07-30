/**
 * The Langy event cursor — a position in a conversation's durable event stream
 * (ADR-059 §2). The server's projection stores persist one next to every folded
 * document; the wire carries it on snapshots and freshness signals; the browser
 * compares it to know whether a tail fetch is due and which events are already
 * folded in.
 *
 * Ordering is `(acceptedAt, eventId)`: the millisecond the canonical event log
 * accepted the event, tie-broken by the event's KSUID. KSUIDs are ASCII, so the
 * tie-break MUST be plain byte-wise string comparison (`<` / `>`), NEVER
 * `localeCompare` — locale collation reorders case and can disagree with KSUID
 * byte order, silently corrupting catch-up on both sides at once.
 */
export interface LangyEventCursor {
  /** When the canonical event log accepted the event (Unix ms, UTC). */
  acceptedAt: number;
  /** KSUID tie-breaker for events accepted in the same millisecond. */
  eventId: string;
}

/** Byte-wise total order over cursors: negative, zero, or positive. */
export function compareLangyEventCursors(
  a: LangyEventCursor,
  b: LangyEventCursor,
): number {
  if (a.acceptedAt !== b.acceptedAt) return a.acceptedAt - b.acceptedAt;
  if (a.eventId === b.eventId) return 0;
  return a.eventId < b.eventId ? -1 : 1;
}

/**
 * Has this cursor folded the given event in already? True when the cursor is
 * at or past the event's own position — the idempotence gate for a client
 * fold, and the projection-readiness gate for the freshness broadcast.
 */
export function cursorHasReachedEvent(
  cursor: LangyEventCursor,
  event: { id: string; createdAt: number },
): boolean {
  return (
    compareLangyEventCursors(cursor, {
      acceptedAt: event.createdAt,
      eventId: event.id,
    }) >= 0
  );
}
