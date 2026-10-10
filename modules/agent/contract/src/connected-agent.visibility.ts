/** Read visibility and run selectability are separate policies (ADR-128). */

import { nowInstant, toEpochMs, type Instant, type TimeInput } from "@langwatch/time";

/** A connected agent unseen this long is treated as gone. */
export const CONNECTED_AGENT_UNSEEN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The oldest `lastSeenAt` that still counts as present. */
export function connectedAgentSeenCutoff(now: Instant = nowInstant()): Instant {
  return now.subtract({ milliseconds: CONNECTED_AGENT_UNSEEN_DAYS * DAY_MS });
}

/** Read visibility and run selectability are separate policies (ADR-128). */
export function isConnectedAgentStale({
  lastSeenAt,
  now = nowInstant(),
}: {
  lastSeenAt: TimeInput | null | undefined;
  now?: Instant;
}): boolean {
  if (!lastSeenAt) return false;
  return toEpochMs(lastSeenAt) < connectedAgentSeenCutoff(now).epochMilliseconds;
}
