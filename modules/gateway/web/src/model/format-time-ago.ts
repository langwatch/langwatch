/**
 * Relative time, as the gateway tables say it.
 *
 * A family-local copy of `platform/app/src/utils/formatTimeAgo.ts`, trimmed to
 * the one export the gateway screens call. The platform module keeps the rest
 * for its own callers and dies with them.
 */

import { format, formatDistanceToNow, nowInstant } from "@langwatch/time";
export const formatTimeAgo = (timestamp: number, dateFormat = "dd/MMM HH:mm", maxHours = 24) => {
  if (!timestamp) return undefined;

  return timestamp < nowInstant().epochMilliseconds - 1000 * 60 * 60 * maxHours
    ? format(timestamp, dateFormat)
    : formatDistanceToNow(timestamp, { addSuffix: true });
};
