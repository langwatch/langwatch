import {
  format,
  formatDistanceToNow,
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
  differenceInWeeks,
} from "date-fns";

export const formatTimeAgo = (
  timestamp: number,
  dateFormat = "dd/MMM HH:mm",
  maxHours = 24,
) => {
  const timestampDate = timestamp ? new Date(timestamp) : undefined;
  const timeAgo = timestampDate
    ? timestampDate.getTime() < Date.now() - 1000 * 60 * 60 * maxHours
      ? format(timestampDate, dateFormat)
      : formatDistanceToNow(timestampDate, {
          addSuffix: true,
        })
    : undefined;

  return timeAgo;
};

/**
 * Format a timestamp as a compact relative time string (e.g., "2m ago", "1h ago").
 * Used for space-constrained UI like command bar recent items.
 */
export function formatTimeAgoCompact(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  const minutes = differenceInMinutes(now, date);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = differenceInHours(now, date);
  if (hours < 24) return `${hours}h ago`;

  const days = differenceInDays(now, date);
  if (days < 7) return `${days}d ago`;

  const weeks = differenceInWeeks(now, date);
  if (days < 30) return `${weeks}w ago`;

  // Use simple 30-day calculation for months to match expected behavior
  return `${Math.floor(days / 30)}mo ago`;
}
