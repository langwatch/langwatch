// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Temporal } from "@langwatch/time";

/** The UTC calendar day of an instant, `YYYY-MM-DD`: the unit an active day is counted in. */
export function utcDayOf(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString().slice(0, 10);
}

/** An instant as ISO-8601 with milliseconds, the form PostHog properties take. */
export function isoOf(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString({
    fractionalSecondDigits: 3,
  });
}
