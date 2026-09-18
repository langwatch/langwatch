import { format, nowInstant, Temporal, toDate, toEpochMs, type TimeInput } from "@langwatch/time";

/** The moment a cell prints and a date control holds, as the `Date` the calendar
 *  helpers and Intl take. One seam for every display string this package draws. */
export function readableDate(value: TimeInput) {
  return toDate(Temporal.Instant.fromEpochMilliseconds(toEpochMs(value)));
}

/** A moment as this package's controls and cells hold it. */
export type ReadableDate = ReturnType<typeof readableDate>;

/**
 * A date as a table cell wants it: "Aug 3" within the current year, "Aug 3,
 * 2025" outside it. The year is what a reader needs to disambiguate an old
 * row, and repeating it on every current-year row is noise.
 */
export function formatShortDate({
  timestampMs,
  now = nowInstant().epochMilliseconds,
}: {
  timestampMs: number;
  now?: number;
}): string {
  if (!Number.isFinite(timestampMs)) return "";
  const date = readableDate(timestampMs);
  const isSameYear = date.getFullYear() === readableDate(now).getFullYear();
  return format(date, isSameYear ? "MMM d" : "MMM d, yyyy");
}
