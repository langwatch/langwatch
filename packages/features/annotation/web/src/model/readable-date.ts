import { Temporal, toDate, toEpochMs, type TimeInput } from "@langwatch/time";

/** The moment a screen prints or a query string names, as a `Date`. */
export function readableDate(value: TimeInput) {
  return toDate(Temporal.Instant.fromEpochMilliseconds(toEpochMs(value)));
}

/** A moment a row or a screen holds for display, as the formatters take one. */
export type DisplayMoment = ReturnType<typeof readableDate>;
