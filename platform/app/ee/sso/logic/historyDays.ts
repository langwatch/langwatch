/**
 * A connection's history, grouped into the days it happened on.
 *
 * THE DATE WAS ON EVERY ROW AND WAS THE SAME ON EVERY ROW. A connection is
 * set up in one sitting, so a log of it reads as seven copies of one date
 * with seven different times beside them — the reader scans past the half
 * that never changes to reach the half that does. Grouping states the date
 * once, as a heading, and leaves each row carrying only what distinguishes
 * it.
 *
 * A PURE FUNCTION OF ITS INPUTS, INCLUDING NOW. "Today" and "Yesterday" are
 * the labels people actually read a log by, and both depend on when the
 * reading happens — so the caller passes the clock rather than the module
 * reaching for one, which is what makes the boundary between one day and the
 * next testable at all.
 *
 * Spec: specs/identity/sso-connection-history.feature
 */

export interface HistoryDayEntry {
  eventId: string;
  occurredAtMs: number;
  summary: string;
  carriedOver: boolean;
}

export interface HistoryDay {
  /** Stable across renders: the local calendar day, not the label. */
  key: string;
  /** "Today", "Yesterday", or the date written out. */
  label: string;
  entries: HistoryDayEntry[];
}

/**
 * The local calendar day something happened on.
 *
 * Local, deliberately: a log is read against the reader's own day, so an
 * event at 23:30 belongs to the evening they remember rather than to
 * whichever UTC day it happened to land in.
 */
function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayLabel({ at, now }: { at: Date; now: Date }): string {
  const key = dayKey(at);
  if (key === dayKey(now)) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday)) return "Yesterday";

  return at.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Days newest first, and within each day the entries newest first — the
 * order the panel already promised and the order the read already returns.
 * Nothing here re-sorts across days: the grouping preserves the sequence it
 * was handed, so an out-of-order read stays visibly out of order rather than
 * being quietly tidied into a shape the event log does not actually have.
 */
export function groupHistoryByDay({
  entries,
  nowMs,
}: {
  entries: readonly HistoryDayEntry[];
  nowMs: number;
}): HistoryDay[] {
  const now = new Date(nowMs);
  const days: HistoryDay[] = [];
  const byKey = new Map<string, HistoryDay>();

  for (const entry of entries) {
    const at = new Date(entry.occurredAtMs);
    const key = dayKey(at);
    const existing = byKey.get(key);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    const day: HistoryDay = {
      key,
      label: dayLabel({ at, now }),
      entries: [entry],
    };
    byKey.set(key, day);
    days.push(day);
  }

  return days;
}
