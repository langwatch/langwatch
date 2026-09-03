/**
 * Relative time, as the Agents pages say it.
 *
 * A family-local copy of `platform/app/src/utils/formatTimeAgo.ts`, trimmed to
 * the one export the Agents screen and its history drawer call, and to a value
 * that is always a string. The platform module keeps the rest for its own
 * callers and dies with them. `@langwatch/enterprise-governance-web` carries
 * the same copy for the same reason.
 */

import { format, formatDistanceToNow } from "date-fns";

const DEFAULT_DATE_FORMAT = "dd/MMM HH:mm";

/** Beyond this, an absolute date reads better than "27 days ago". */
const RELATIVE_WINDOW_HOURS = 24;

export function formatTimeAgo(
  timestamp: number,
  dateFormat = DEFAULT_DATE_FORMAT,
  maxHours = RELATIVE_WINDOW_HOURS,
): string {
  if (!timestamp) return "";

  const at = new Date(timestamp);
  if (at.getTime() < Date.now() - 1000 * 60 * 60 * maxHours) {
    return format(at, dateFormat);
  }
  return formatDistanceToNow(at, { addSuffix: true });
}
