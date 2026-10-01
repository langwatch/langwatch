/**
 * The daily report goes at 12:00 UTC. The schedule wakes hourly and asks these
 * two questions of epoch milliseconds, so no clock is read here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOON_MS = 12 * 60 * 60 * 1000;

/** The most recent 12:00 UTC at or before this instant. */
function lastNoonAtOrBefore(at: number): number {
  const noonToday = Math.floor(at / DAY_MS) * DAY_MS + NOON_MS;
  return at >= noonToday ? noonToday : noonToday - DAY_MS;
}

/** The next 12:00 UTC strictly after this instant: today's while it is still ahead. */
export function nextNoonUtc(at: number): number {
  return lastNoonAtOrBefore(at) + DAY_MS;
}

/** Whether a 12:00 UTC has passed since the last report was taken. */
export function isUsageReportDue({
  at,
  lastReportAt,
}: {
  at: number;
  lastReportAt: number;
}): boolean {
  return lastNoonAtOrBefore(at) > lastReportAt;
}
