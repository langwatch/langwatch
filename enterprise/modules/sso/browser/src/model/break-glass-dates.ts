// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The two dates the break-glass control deals in, in the reader's own
 * timezone. A `<input type="date">` hands over a LOCAL calendar date, and
 * reading it as UTC put the grants table a day ahead of the picker still
 * sitting above it: one instant later is the next day anywhere east of UTC.
 * Both build a plain calendar date first and only then attach the zone.
 */
import { format, Temporal, toZonedDateTime, type TimeInput } from "@langwatch/time";

/** The last instant of the local day somebody picked. NaN for a date we cannot read. */
export function endOfLocalDay(isoDate: string): number {
  const parts = isoDate.split("-").map(Number);
  const [year, month, day] = parts;
  if (parts.length !== 3 || !year || !month || !day) return Number.NaN;
  if (month < 1 || month > 12 || day < 1 || day > 31) return Number.NaN;

  return Temporal.PlainDateTime.from({
    year,
    month,
    day,
    hour: 23,
    minute: 59,
    second: 59,
    millisecond: 999,
  }).toZonedDateTime(Temporal.Now.timeZoneId()).epochMilliseconds;
}

/**
 * A `yyyy-mm-dd` the date input can hold, `days` from today where the reader
 * is. An answer read in UTC names tomorrow late in the evening east of it, and
 * the bound it computes is then a day out from the day the reader is having.
 */
export function localIsoDateInDays(
  days: number,
  now: TimeInput = Temporal.Now.zonedDateTimeISO(),
): string {
  return format(toZonedDateTime(now).add({ days }), "yyyy-MM-dd");
}
