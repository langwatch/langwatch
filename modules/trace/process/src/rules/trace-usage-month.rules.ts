import { Temporal } from "@langwatch/time";

/** `YYYY-MM` of an instant in UTC: the month a trace first seen then is counted in. */
export function usageMonthOf(epochMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMs)
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toPlainYearMonth()
    .toString();
}

/** The first instant of a `YYYY-MM` month, UTC, in epoch ms. */
export function monthStartOf(month: string): number {
  return Temporal.PlainYearMonth.from(month)
    .toPlainDate({ day: 1 })
    .toZonedDateTime({ timeZone: "UTC" }).epochMilliseconds;
}
