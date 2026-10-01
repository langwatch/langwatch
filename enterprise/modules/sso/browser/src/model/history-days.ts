// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A connection's history, grouped into the days it happened on. A connection
 * is set up in one sitting, so an ungrouped log reads as seven copies of one
 * date with seven different times beside them. A pure function of its inputs
 * including now: "Today" and "Yesterday" depend on when the reading happens,
 * so the caller passes the clock.
 */
import { format, isSameCalendarDay, toZonedDateTime } from "@langwatch/time";

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
 * The local calendar day something happened on — local deliberately, so an
 * event at 23:30 belongs to the evening the reader remembers.
 */
function dayKey(occurredAtMs: number): string {
  return format(occurredAtMs, "yyyy-MM-dd");
}

function dayLabel({ occurredAtMs, nowMs }: { occurredAtMs: number; nowMs: number }): string {
  if (isSameCalendarDay(occurredAtMs, nowMs)) return "Today";

  const yesterday = toZonedDateTime(nowMs).subtract({ days: 1 });
  if (isSameCalendarDay(occurredAtMs, yesterday)) return "Yesterday";

  return format(occurredAtMs, "d MMMM yyyy");
}

/**
 * Days newest first, and within each day the entries newest first — the order
 * the read already returns. Nothing re-sorts across days, so an out-of-order
 * read stays visibly out of order rather than being tidied into a shape the
 * event log does not have.
 */
export function groupHistoryByDay({
  entries,
  nowMs,
}: {
  entries: readonly HistoryDayEntry[];
  nowMs: number;
}): HistoryDay[] {
  const days: HistoryDay[] = [];
  const byKey = new Map<string, HistoryDay>();

  for (const entry of entries) {
    const key = dayKey(entry.occurredAtMs);
    const existing = byKey.get(key);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    const day: HistoryDay = {
      key,
      label: dayLabel({ occurredAtMs: entry.occurredAtMs, nowMs }),
      entries: [entry],
    };
    byKey.set(key, day);
    days.push(day);
  }

  return days;
}
