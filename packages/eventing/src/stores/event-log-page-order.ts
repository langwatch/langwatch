import type { Event } from "../domain/types.ts";

/**
 * Where a paged history read resumes. Pages follow event_log's sort key so each one seeks
 * through the primary index; time and id only break ties between unmerged copies of a key.
 * Page order is not time order: only a fold with `refoldOnOutOfOrder: false` may read pages.
 */
export interface EventLogPageCursor {
  /** The stored key; a row stored without one sorts as "", as event_log holds it. */
  idempotencyKey: string;
  timestamp: number;
  eventId: string;
}

/** Page order: key, then arrival time, then id, compared as event_log compares them. */
export function compareEventLogPagePositions(
  left: EventLogPageCursor,
  right: EventLogPageCursor,
): number {
  const byKey = compareCodePoints(left.idempotencyKey, right.idempotencyKey);
  if (byKey !== 0) return byKey;
  if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
  return compareCodePoints(left.eventId, right.eventId);
}

/**
 * Code point order, which is UTF-8 byte order and so ClickHouse's: UTF-16 order differs once a
 * surrogate pair meets a unit from U+E000 to U+FFFF, so those units are shifted to match.
 */
function compareCodePoints(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftUnit = left.charCodeAt(index);
    const rightUnit = right.charCodeAt(index);
    if (leftUnit !== rightUnit) return codePointRank(leftUnit) - codePointRank(rightUnit);
  }
  return left.length - right.length;
}

/** A UTF-16 unit's rank in code point order: surrogates sort after U+E000 to U+FFFF. */
function codePointRank(unit: number): number {
  if (unit < 0xd800) return unit;
  return unit >= 0xe000 ? unit - 0x800 : unit + 0x2000;
}

/** An event's place in page order. */
export function eventLogPagePositionOf(event: Event): EventLogPageCursor {
  return {
    idempotencyKey: event.idempotencyKey ?? "",
    timestamp: event.createdAt,
    eventId: event.id,
  };
}

/** Page order over events. */
export function compareEventLogPageOrder(left: Event, right: Event): number {
  return compareEventLogPagePositions(eventLogPagePositionOf(left), eventLogPagePositionOf(right));
}

/**
 * The cursor after a page: its furthest event in page order, not its last element, so a store
 * that reorders a page (the memory store sorts it by arrival) still resumes in the right place.
 */
export function eventLogPageCursorAfter(page: readonly Event[]): EventLogPageCursor | undefined {
  let furthest: EventLogPageCursor | undefined;
  for (const event of page) {
    const position = eventLogPagePositionOf(event);
    if (!furthest || compareEventLogPagePositions(position, furthest) > 0) furthest = position;
  }
  return furthest;
}
