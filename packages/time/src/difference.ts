/**
 * How far apart two moments are. Calendar units (days, weeks, months) count on
 * the reader's calendar, so a clock change adds an hour and not a day; elapsed
 * units (hours, minutes, seconds) count real time and truncate.
 */

import { Temporal } from "./temporal.ts";
import { toEpochMs, toZonedDateTime, type TimeInput, type ZoneOptions } from "./zoned.ts";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/** Elapsed milliseconds from `earlier` to `later`; negative when `later` is first. */
export function differenceInMilliseconds(later: TimeInput, earlier: TimeInput): number {
  return toEpochMs(later) - toEpochMs(earlier);
}

export function differenceInSeconds(later: TimeInput, earlier: TimeInput): number {
  return Math.trunc(differenceInMilliseconds(later, earlier) / MS_PER_SECOND);
}

export function differenceInMinutes(later: TimeInput, earlier: TimeInput): number {
  return Math.trunc(differenceInMilliseconds(later, earlier) / MS_PER_MINUTE);
}

export function differenceInHours(later: TimeInput, earlier: TimeInput): number {
  return Math.trunc(differenceInMilliseconds(later, earlier) / MS_PER_HOUR);
}

/**
 * Calendar days crossed: midnight-to-midnight on the reader's calendar, so two
 * moments four hours apart either side of local midnight are one day apart.
 */
export function differenceInCalendarDays(
  later: TimeInput,
  earlier: TimeInput,
  options?: ZoneOptions,
): number {
  const laterDay = toZonedDateTime(later, options).toPlainDate();
  const earlierDay = toZonedDateTime(earlier, options).toPlainDate();
  return laterDay.since(earlierDay, { largestUnit: "day" }).days;
}

/** Whole days elapsed, truncated toward zero and read on the reader's calendar. */
export function differenceInDays(
  later: TimeInput,
  earlier: TimeInput,
  options?: ZoneOptions,
): number {
  const laterZoned = toZonedDateTime(later, options);
  const earlierZoned = toZonedDateTime(earlier, options);
  return laterZoned.since(earlierZoned, {
    largestUnit: "day",
    smallestUnit: "day",
    roundingMode: "trunc",
  }).days;
}

/** Whole weeks elapsed, truncated toward zero. */
export function differenceInWeeks(
  later: TimeInput,
  earlier: TimeInput,
  options?: ZoneOptions,
): number {
  return Math.trunc(differenceInDays(later, earlier, options) / 7);
}

/** Whole calendar months elapsed, truncated toward zero. */
export function differenceInMonths(
  later: TimeInput,
  earlier: TimeInput,
  options?: ZoneOptions,
): number {
  const laterZoned = toZonedDateTime(later, options);
  const earlierZoned = toZonedDateTime(earlier, options);
  return laterZoned.since(earlierZoned, {
    largestUnit: "month",
    smallestUnit: "month",
    roundingMode: "trunc",
  }).months;
}

/**
 * Seconds between the two wall clocks, ignoring a clock change: what a reader
 * would say elapsed, which is what relative-time wording counts in.
 */
export function wallClockSecondsBetween(
  later: TimeInput,
  earlier: TimeInput,
  options?: ZoneOptions,
): number {
  const laterWall = toZonedDateTime(later, options).toPlainDateTime();
  const earlierWall = toZonedDateTime(earlier, options).toPlainDateTime();
  const elapsed = laterWall.since(earlierWall, { largestUnit: "hour" });
  return elapsed.total({ unit: "second" });
}

/** Exported so the relative-time wording can compare two moments in one place. */
export function compareMoments(later: TimeInput, earlier: TimeInput): number {
  return Temporal.Instant.compare(
    Temporal.Instant.fromEpochMilliseconds(toEpochMs(later)),
    Temporal.Instant.fromEpochMilliseconds(toEpochMs(earlier)),
  );
}
