import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";

import { formatShortDate } from "./shortDate";

/** A day, the point where "how long ago" stops beating "which day". */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * When a row last moved. Inside the last day that is a distance ("3h ago"),
 * because the reader is asking whether it is still warm. Older than that the
 * distance stops meaning anything and the date is what they want, in the same
 * short form the other date columns use.
 */
export function formatLastUpdate({
  timestampMs,
  now = Date.now(),
}: {
  timestampMs: number;
  now?: number;
}): string {
  if (now - timestampMs < RECENT_WINDOW_MS) {
    return formatTimeAgoCompact(timestampMs, now);
  }
  return formatShortDate({ timestampMs, now });
}
