import { Temporal, toDate, toEpochMs, type TimeInput } from "@langwatch/time";

/** The moment a screen prints, as the `Date` the Intl formatters take. */
export function readableDate(value: TimeInput) {
  return toDate(Temporal.Instant.fromEpochMilliseconds(toEpochMs(value)));
}
