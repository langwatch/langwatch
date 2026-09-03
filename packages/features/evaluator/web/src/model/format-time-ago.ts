/**
 * "3 minutes ago", or a date once that stops being useful.
 *
 * A NARROWED FAMILY-LOCAL COPY of `platform/app/src/utils/formatTimeAgo.ts`,
 * which twenty-three platform modules read and deletes-only forbids repointing.
 * What travelled is the relative half; `formatTimeAgoCompact`, which the command
 * bar's recent items use and nothing here does, stayed behind.
 */

import { format, formatDistanceToNow } from "date-fns";

export const formatTimeAgo = (timestamp: number, dateFormat = "dd/MMM HH:mm", maxHours = 24) => {
  const timestampDate = timestamp ? new Date(timestamp) : undefined;
  const timeAgo = timestampDate
    ? timestampDate.getTime() < Date.now() - 1000 * 60 * 60 * maxHours
      ? format(timestampDate, dateFormat)
      : formatDistanceToNow(timestampDate, { addSuffix: true })
    : undefined;

  return timeAgo;
};
