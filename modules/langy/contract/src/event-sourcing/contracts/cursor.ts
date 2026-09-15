import { z } from "zod";

/**
 * A position in a conversation's durable event stream (ADR-059 §2). Ordered
 * by `(acceptedAt, eventId)`; tie-break MUST be byte-wise (`<`/`>`), NEVER
 * `localeCompare` — it can disagree with KSUID byte order.
 */
export const langyEventCursorSchema = z.object({
  /** When the canonical event log accepted the event (Unix ms, UTC). */
  acceptedAt: z.number().int().nonnegative(),
  /** KSUID tie-breaker for events accepted in the same millisecond. */
  eventId: z.string(),
});

export type LangyEventCursor = z.infer<typeof langyEventCursorSchema>;

/** Byte-wise total order over cursors: negative, zero, or positive. */
export function compareLangyEventCursors(a: LangyEventCursor, b: LangyEventCursor): number {
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
