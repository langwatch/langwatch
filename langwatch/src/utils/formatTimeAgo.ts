import { format, formatDistanceToNow } from "date-fns";

export const formatTimeAgo = (timestamp: number, dateFormat="dd/MMM HH:mm", maxHours = 24) => {
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
