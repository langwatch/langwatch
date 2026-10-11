import { Temporal } from "@langwatch/time";

const HOUR_MS = 3_600_000;

/**
 * How far a span's append may sit after its summary's first write and still be the trace's first
 * sighting: the api and the worker stamp with different clocks. A minute absorbs the skew.
 */
export const FIRST_SIGHTING_CLOCK_SKEW_MS = 60_000;

/** `YYYY-MM` of an instant in UTC: the month a first sighting is counted in. */
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

/** The count's cut: the next whole UTC hour at or after an instant, so it falls on an hour. */
export function countCutAfter(epochMs: number): number {
  return Math.ceil(epochMs / HOUR_MS) * HOUR_MS;
}

/**
 * Whether a span belongs to the batch that first wrote its trace's summary: appended no later than
 * that write (plus the skew). Spans appended after it never are, however late they fold.
 */
export function isFirstSighting({
  spanAppendedAt,
  summaryCreatedAt,
}: {
  spanAppendedAt: number;
  summaryCreatedAt: number;
}): boolean {
  return spanAppendedAt <= summaryCreatedAt + FIRST_SIGHTING_CLOCK_SKEW_MS;
}
