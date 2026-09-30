/**
 * The two dates the break-glass control deals in, in the reader's own
 * timezone.
 *
 * A `<input type="date">` hands over a LOCAL CALENDAR DATE — "2026-10-16",
 * with no timezone in it at all. Turning that into an instant through UTC is
 * what put the grants table a day ahead of the picker still sitting above it:
 * `2026-10-16T23:59:59.999Z` is the 17th anywhere east of UTC, so a grant
 * picked for the 16th displayed as ending on the 17th.
 *
 * Both functions therefore build their result field by field rather than
 * parsing or serialising through an ISO string, because the difference this
 * turns on is a punctuation mark: `new Date("2026-10-16")` is specified to be
 * UTC midnight while `new Date("2026/10/16")` is local midnight.
 *
 * Spec: specs/identity/sso-activation.feature
 */

/** The last instant of the local day somebody picked. NaN for a date we cannot read. */
export function endOfLocalDay(isoDate: string): number {
  const parts = isoDate.split("-").map(Number);
  const [year, month, day] = parts;
  if (parts.length !== 3 || !year || !month || !day) return Number.NaN;
  if (month < 1 || month > 12 || day < 1 || day > 31) return Number.NaN;
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

/**
 * A `yyyy-mm-dd` the date input can hold, `days` from today where the reader
 * is. `toISOString().slice(0, 10)` is UTC, so late in the evening east of UTC
 * it names tomorrow — and the bound it computes is then a day out from the
 * day the reader is actually having.
 */
export function localIsoDateInDays(
  days: number,
  now: Date = new Date(),
): string {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + days);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
