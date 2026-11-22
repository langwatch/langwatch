// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Temporal } from "@langwatch/time";

/** The UTC calendar day of an instant, `YYYY-MM-DD`: the unit an active day is counted in. */
export function utcDayOf(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString().slice(0, 10);
}

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/** How many UTC calendar days `to` falls after `from`; negative when it falls before. */
export function utcDayOffset({ from, to }: Readonly<{ from: number; to: number }>): number {
  return Math.floor(to / DAY_MILLISECONDS) - Math.floor(from / DAY_MILLISECONDS);
}

/** An instant as ISO-8601 with milliseconds, the form PostHog properties take. */
export function isoOf(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString({
    fractionalSecondDigits: 3,
  });
}
