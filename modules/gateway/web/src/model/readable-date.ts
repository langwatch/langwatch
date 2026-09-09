/**
 * The one place a moment becomes the `Date` the browser's formatters take.
 * `Intl` accepts nothing else, and one seam is what keeps the printed
 * strings byte-identical to what they were before the clock changed.
 */

import { Temporal, type TimeInput, toDate, toEpochMs } from "@langwatch/time";

/** The moment a screen prints, as the `Date` the Intl formatters take. */
export function readableDate(value: TimeInput) {
  return toDate(Temporal.Instant.fromEpochMilliseconds(toEpochMs(value)));
}
