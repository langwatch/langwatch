/**
 * How long ago something happened, in the two shapes this product prints.
 *
 * Sixteen web packages carried a copy of one or both of these, and the copies
 * had drifted: three returned "" for a falsy timestamp where the rest returned
 * undefined, and four reimplemented the compact ladder in arithmetic rather
 * than `date-fns`. Both readings are the same reading, so a row that moved an
 * hour ago now reads the same wherever it is drawn.
 */

import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInWeeks,
  format,
  formatDistanceToNow,
} from "date-fns";

/** Beyond this, an absolute date reads better than "27 days ago". */
const RELATIVE_WINDOW_HOURS = 24;

const DEFAULT_DATE_FORMAT = "dd/MMM HH:mm";

/**
 * "12 minutes ago" while it is recent, an absolute stamp once it is not.
 *
 * Undefined for a falsy timestamp, which is what the table cells check before
 * printing an em dash. The three copies that answered "" instead now read
 * `?? ""` at the call site, so nothing prints "undefined".
 */
export function formatTimeAgo(
  timestamp: number,
  dateFormat = DEFAULT_DATE_FORMAT,
  maxHours = RELATIVE_WINDOW_HOURS,
): string | undefined {
  if (!timestamp) return void 0;
  const at = new Date(timestamp);
  if (at.getTime() < Date.now() - 1000 * 60 * 60 * maxHours) {
    return format(at, dateFormat);
  }
  return formatDistanceToNow(at, { addSuffix: true });
}

/** The same instant in the space a table row has: "2m ago", "1h ago". */
export function formatTimeAgoCompact(timestamp: number, nowMs?: number): string {
  const date = new Date(timestamp);
  const now = nowMs ? new Date(nowMs) : new Date();

  const minutes = differenceInMinutes(now, date);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = differenceInHours(now, date);
  if (hours < 24) return `${hours}h ago`;

  const days = differenceInDays(now, date);
  if (days < 7) return `${days}d ago`;

  const weeks = differenceInWeeks(now, date);
  if (days < 30) return `${weeks}w ago`;

  // Simple 30-day months, matching the application helper this came from.
  return `${Math.floor(days / 30)}mo ago`;
}
