// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The calendar a connected customer's monthly statement is cut on (ADR-156 section 7), in UTC. */

import { Temporal, type Instant } from "@langwatch/time";

/** The first instant of the month `shift` months from the one `at` falls in. */
function monthStartOf(at: Instant, shift: number): Instant {
  const zoned = at.toZonedDateTimeISO("UTC");

  return Temporal.PlainDateTime.from({ year: zoned.year, month: zoned.month, day: 1 })
    .add({ months: shift })
    .toZonedDateTime("UTC")
    .toInstant();
}

/** The first instant of the month before the one `now` falls in: the month a tick covers. */
export function previousMonthStart(now: Instant): Instant {
  return monthStartOf(now, -1);
}

/** The first instant of the month after the one starting at `month`. */
export function nextMonthStart(month: Instant): Instant {
  return monthStartOf(month, 1);
}

/** What is left of the commit, never below zero. */
export function creditRemainingUsdCents({
  commitUsdCents,
  drawnDownUsdCents,
}: {
  commitUsdCents: number;
  drawnDownUsdCents: number;
}): number {
  return Math.max(0, commitUsdCents - drawnDownUsdCents);
}
