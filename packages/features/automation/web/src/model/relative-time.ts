/**
 * How long ago something happened, in the two shapes this family prints.
 *
 * A family-local copy of `platform/app`'s `~/utils/formatTimeAgo`, taken rather
 * than promoted: it is nine lines of `date-fns` around a threshold, and the
 * application still has half a dozen callers that deletes-only forbids
 * repointing. The same call the me family made for its own copies.
 */

import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInWeeks,
  format,
  formatDistanceToNow,
} from "date-fns";

/**
 * "12 minutes ago" while it is recent, an absolute stamp once it is not.
 *
 * Undefined for a falsy timestamp, which is what the table cells check before
 * printing an em dash.
 */
export const formatTimeAgo = (
  timestamp: number,
  dateFormat = "dd/MMM HH:mm",
  maxHours = 24,
): string | undefined => {
  const timestampDate = timestamp ? new Date(timestamp) : undefined;
  return timestampDate
    ? timestampDate.getTime() < Date.now() - 1000 * 60 * 60 * maxHours
      ? format(timestampDate, dateFormat)
      : formatDistanceToNow(timestampDate, { addSuffix: true })
    : undefined;
};

/** The same instant in the space a preview row has: "2m ago", "1h ago". */
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

  return `${Math.floor(days / 30)}mo ago`;
}
