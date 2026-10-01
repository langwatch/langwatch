import { Cron } from "croner";

import type { Instant } from "./temporal.ts";
import { fromDate, toDate } from "./zoned.ts";

/**
 * The first instant strictly after `after` that `cron` names, read in the IANA
 * `timezone` so it tracks DST.
 */
export function computeNextRunAt({
  cron,
  timezone,
  after,
}: {
  cron: string;
  timezone: string;
  after: Instant;
}): Instant {
  const next = new Cron(cron, { timezone }).nextRun(toDate(after));
  if (!next) {
    throw new Error(
      `computeNextRunAt: cron "${cron}" (tz "${timezone}") has no run after ${after.toString()}`,
    );
  }
  return fromDate(next);
}
