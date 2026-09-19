/**
 * What a license reported about its seats, kept per quarter of its own term
 * (ADR-139, section 6).
 *
 * The quarterly seat true-up invoices the peak, not the last figure, so a
 * customer that runs 53 seats for a week and drops back to 51 is still
 * invoiced for 53. The quarter is counted from the license's `issuedAt` in
 * three-month steps rather than from the calendar year, because that is the
 * period the contract runs on.
 *
 * Nothing here reads a database or the environment.
 */

/** One quarter of one license, at the highest seats it reported. */
export interface LicenseSeatReportRecord {
  id: string;
  /** The `IssuedLicense` row id. */
  licenseId: string;
  quarterStartsAt: Date;
  peakMembers: number;
  peakMembersLite: number;
  firstReportedAt: Date;
  lastReportedAt: Date;
}

/** One license's quarter, as the caller names it. */
export interface LicenseSeatQuarterKey {
  licenseId: string;
  quarterStartsAt: Date;
}

export interface LicenseSeatReportRepository {
  /**
   * Raises the quarter's peak to what was just reported, creating the row on
   * the first report of that quarter. Never lowers a peak.
   */
  recordPeak(params: {
    licenseId: string;
    quarterStartsAt: Date;
    members: number;
    membersLite: number;
    at: Date;
  }): Promise<LicenseSeatReportRecord>;
  /** The rows for the named quarters, in one read. */
  findByQuarters(
    keys: LicenseSeatQuarterKey[],
  ): Promise<LicenseSeatReportRecord[]>;
}

const MONTHS_PER_QUARTER = 3;

/**
 * The start of the term quarter that `now` falls in. A `now` before the
 * license was issued reads as the first quarter, so a clock that runs behind
 * cannot open a quarter of its own.
 */
export function licenseTermQuarterStart({
  issuedAt,
  now,
}: {
  issuedAt: Date;
  now: Date;
}): Date {
  const quarters = Math.floor(
    fullMonthsBetween(issuedAt, now) / MONTHS_PER_QUARTER,
  );
  return addMonths(issuedAt, Math.max(0, quarters) * MONTHS_PER_QUARTER);
}

/** The key a quarter's row is stored under. */
export function seatQuarterKeyFor({
  licenseId,
  issuedAt,
  now,
}: {
  licenseId: string;
  issuedAt: Date;
  now: Date;
}): LicenseSeatQuarterKey {
  return {
    licenseId,
    quarterStartsAt: licenseTermQuarterStart({ issuedAt, now }),
  };
}

/**
 * The same day-of-month `months` later, clamped to the last day of the target
 * month, so a license issued on the 31st keeps its anniversary instead of
 * rolling into the next month.
 */
function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const target = new Date(date.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** Whole months from `from` to `to`, negative when `to` comes first. */
function fullMonthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  return addMonths(from, months) > to ? months - 1 : months;
}
