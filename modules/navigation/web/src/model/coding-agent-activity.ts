/** Project coding-agent instrumentation recent enough to keep sidebar destinations */

import { toEpochMs, type Instant, type TimeInput } from "@langwatch/time";

/** How long after the last signal a coding-agent destination stays offered. */
export const CODING_AGENT_LINK_WINDOW_DAYS = 15;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Checks if moment is within window; now is parameter so caller decides clock */
export function withinDays({
  at,
  days,
  now,
}: {
  at: TimeInput | null | undefined;
  days: number;
  now: Instant;
}): boolean {
  if (!at) return false;
  const moment = toEpochMs(at);
  if (Number.isNaN(moment)) return false;
  return moment > now.epochMilliseconds - days * MS_PER_DAY;
}
