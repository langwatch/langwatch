/**
 * Moving around the reader's calendar: whole days added or removed keep the
 * wall-clock time across a clock change, and a day starts at local midnight.
 */

import { toDate, toZonedDateTime, type TimeInput, type ZoneOptions } from "./zoned.ts";

/** The same time of day, `amount` days later. */
export function addDays(value: TimeInput, amount: number, options?: ZoneOptions): Date {
  return toDate(toZonedDateTime(value, options).add({ days: amount }));
}

/** The same time of day, `amount` days earlier. */
export function subDays(value: TimeInput, amount: number, options?: ZoneOptions): Date {
  return toDate(toZonedDateTime(value, options).subtract({ days: amount }));
}

/** Local midnight that begins the day the moment falls in. */
export function startOfDay(value: TimeInput, options?: ZoneOptions): Date {
  return toDate(toZonedDateTime(value, options).startOfDay());
}

/** True when the moment falls on the reader's today. */
export function isToday(value: TimeInput, options?: ZoneOptions): boolean {
  return isSameCalendarDay(value, Date.now(), options);
}

/** True when the moment falls on the reader's yesterday. */
export function isYesterday(value: TimeInput, options?: ZoneOptions): boolean {
  return isSameCalendarDay(value, subDays(Date.now(), 1, options), options);
}

/** True when both moments fall on one calendar day for the reader. */
export function isSameCalendarDay(
  left: TimeInput,
  right: TimeInput,
  options?: ZoneOptions,
): boolean {
  return toZonedDateTime(left, options)
    .toPlainDate()
    .equals(toZonedDateTime(right, options).toPlainDate());
}
