import { nowInstant, Temporal, type Instant } from "@langwatch/time";

/**
 * A ClickHouse outage and a verified zero call for different responses:
 * skip the month on outage, but a legitimate zero may be reported. Named
 * so the outage isn't collapsed into a value the query never produced.
 */
export type BillableEventsTotalResult =
  | { outcome: "counted"; total: number }
  | { outcome: "unavailable" };

/** Formats a moment as its UTC billing month string (YYYY-MM). */
export function billingMonthOf({ now = nowInstant() }: { now?: Instant } = {}): string {
  const utc = now.toZonedDateTimeISO("UTC");

  return `${utc.year}-${String(utc.month).padStart(2, "0")}`;
}

/** The UTC billing month before the one the moment falls in. */
export function previousBillingMonthOf({ now = nowInstant() }: { now?: Instant } = {}): string {
  const previous = now.toZonedDateTimeISO("UTC").subtract({ months: 1 });

  return `${previous.year}-${String(previous.month).padStart(2, "0")}`;
}

/** Converts YYYY-MM into a ClickHouse [start, end) datetime range. */
export function billingMonthDateRange({
  billingMonth,
}: {
  billingMonth: string;
}): [string, string] {
  const [yearText, monthText] = billingMonth.split("-") as [string, string];
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const startDate = `${year}-${String(month).padStart(2, "0")}-01 00:00:00.000`;
  const nextMonth = Temporal.PlainDateTime.from({ year, month: 1, day: 1 }).add({
    months: month,
  });

  return [
    startDate,
    `${nextMonth.year}-${String(nextMonth.month).padStart(2, "0")}-01 00:00:00.000`,
  ];
}
