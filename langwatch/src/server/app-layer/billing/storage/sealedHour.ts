export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Floor an instant to the start of its UTC hour. */
export function floorToHour(at: Date): Date {
  return new Date(Math.floor(at.getTime() / MS_PER_HOUR) * MS_PER_HOUR);
}

/**
 * The most recent SEALED hour at `at`: the last fully-elapsed UTC hour.
 * At 14:25 the sealed hour is 13:00 (14:00 is still filling).
 */
export function currentSealedHour(at: Date): Date {
  return new Date(floorToHour(at).getTime() - MS_PER_HOUR);
}

/** Floor an instant to UTC midnight of its day. */
export function floorToDay(at: Date): Date {
  return new Date(Math.floor(at.getTime() / MS_PER_DAY) * MS_PER_DAY);
}

/**
 * UTC midnight of the SUNDAY starting the ClickHouse week-partition that
 * contains `day`. Verified against toYearWeek (default mode): weeks start
 * Sunday and stay contiguous across year boundaries (2025-12-31 and
 * 2026-01-01 share partition 202552), so Sunday-flooring in date space maps
 * one-to-one onto physical partitions with no year-week arithmetic.
 */
export function partitionStartFor(day: Date): Date {
  const floored = floorToDay(day);
  // 1970-01-01 was a Thursday; day 3 after it was the first Sunday.
  const daysSinceEpoch = Math.floor(floored.getTime() / MS_PER_DAY);
  const daysSinceSunday = (daysSinceEpoch + 4) % 7;
  return new Date(floored.getTime() - daysSinceSunday * MS_PER_DAY);
}

/**
 * Stable label for a week partition: the ISO date of its Sunday start
 * (e.g. "2026-06-21"). Used as StorageBoundaryEvent.partitionKey — a label
 * in event identity, never sent to ClickHouse (queries bound partitions by
 * date range on the partition-aligned retention column).
 */
export function partitionKeyFor(day: Date): string {
  return partitionStartFor(day).toISOString().slice(0, 10);
}
