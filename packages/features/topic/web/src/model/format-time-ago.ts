/**
 * Relative time, as the clustering schedule and its run history say it.
 *
 * A family-local copy of `platform/app/src/utils/formatTimeAgo.ts`, byte for
 * byte the copy `@langwatch/api-key-web`, `@langwatch/agent-web` and
 * `@langwatch/enterprise-governance-web` already carry, and taken for the same
 * reason: the platform module has eighty importers and the deletes-only ruling
 * forbids repointing a single one.
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
