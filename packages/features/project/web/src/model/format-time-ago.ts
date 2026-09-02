import { format, formatDistanceToNow } from "date-fns";

/**
 * A timestamp as prose — "3 hours ago", and a date once it is old enough.
 *
 * The package's own copy of `platform/app`'s `formatTimeAgo`, which no longer
 * exists to move: `utils/formatTimeAgo.ts` went with the workflow family, and
 * the compact half of it is `@langwatch/navigation-web`'s
 * `formatTimeAgoCompact`. The ladder is unchanged, so a row the home lists and
 * a row a moved page lists still read the same.
 */
export const formatTimeAgo = (
  timestamp: number,
  dateFormat = "dd/MMM HH:mm",
  maxHours = 24,
): string | undefined => {
  const timestampDate = timestamp ? new Date(timestamp) : void 0;
  if (!timestampDate) return void 0;
  return timestampDate.getTime() < Date.now() - 1000 * 60 * 60 * maxHours
    ? format(timestampDate, dateFormat)
    : formatDistanceToNow(timestampDate, { addSuffix: true });
};
