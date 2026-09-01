import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInWeeks,
} from "date-fns";

/**
 * A timestamp as a compact distance — "2m ago", "1h ago", "3d ago".
 *
 * The package's own copy of `platform/app`'s `formatTimeAgoCompact`, taken
 * rather than imported because a feature-web package may not reach into the
 * application. The ladder is the application's, unchanged, so a row that moved
 * an hour ago still reads the same on either side of the move.
 */
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
