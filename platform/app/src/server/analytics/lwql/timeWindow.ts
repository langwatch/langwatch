/**
 * LangWatchQL analytics SQL — the time-window vocabulary.
 *
 * A statement says whether it follows the surface's period by *declaring* two
 * reserved bound parameters, `{period_start:DateTime}` and
 * `{period_end:DateTime}`. Nothing else records the fact: a field on the saved
 * record would be a second source of truth able to disagree with the statement
 * it describes, and the disagreement would surface as a chart quietly showing a
 * different period from the one beside it — which is the whole failure this
 * contract exists to prevent.
 *
 * The interval those two names describe is half-open, `[period_start,
 * period_end)`. A convention this module documents rather than something it can
 * enforce — the author writes the comparison — and it is what the schema
 * browser tells a member writing SQL.
 *
 * ## This module has no imports, and must not gain any
 *
 * The workbench reads it too: the fields a member sees have to show the same
 * spelling the database is bound with, and a second copy of the format in the
 * browser is a drift bug waiting for the first change. Importing anything
 * server-side here — the handled errors, the remediation registry — would ship
 * that to every browser. The policy those errors belong to lives next door in
 * `./resolveTimeWindow.ts`, which the browser never loads.
 *
 * @see ./resolveTimeWindow.ts — what a surface may and may not do with these
 * @see specs/analytics/lwql-workbench.feature
 */

/** The window a surface hands a statement, as instants. Half-open: `[start, end)`. */
export interface LangWatchQLTimeWindow {
  readonly start: Date;
  readonly end: Date;
}

/** Inclusive lower bound of the period the surface is showing. */
export const LWQL_PERIOD_START_PARAMETER = "period_start";

/** Exclusive upper bound of the period the surface is showing. */
export const LWQL_PERIOD_END_PARAMETER = "period_end";

/**
 * The names a statement may declare to follow the surface's period.
 *
 * Namespaced with a `period_` prefix so that a later well-known parameter —
 * `period_granularity`, `period_timezone` — cannot collide with a name a member
 * was already using for something of their own.
 */
export const LWQL_TIME_WINDOW_PARAMETERS = [
  LWQL_PERIOD_START_PARAMETER,
  LWQL_PERIOD_END_PARAMETER,
] as const;

export type LangWatchQLTimeWindowParameter =
  (typeof LWQL_TIME_WINDOW_PARAMETERS)[number];

/** Whether a parameter name is one the surface owns. */
export function isLangWatchQLTimeWindowParameter(
  name: string,
): name is LangWatchQLTimeWindowParameter {
  return (LWQL_TIME_WINDOW_PARAMETERS as readonly string[]).includes(
    name,
  );
}

/**
 * `DateTime`, `DateTime('UTC')`, `DateTime64(3)`, `DateTime64(3, 'UTC')`.
 *
 * Case-sensitive, and deliberately not widened to `Date` or `Nullable(...)`:
 * the injected value carries a time, so binding it to a day-resolution type
 * would truncate the window without saying so, and a window that may be null is
 * not a window.
 *
 * A zone argument other than `'UTC'` is refused too. The injected value is a
 * UTC wall clock with no zone designator, and ClickHouse reads it in the
 * declared zone — `DateTime('Asia/Tokyo')` would shift the whole window by
 * nine hours without a word. The bare spellings stay allowed: with no zone
 * argument the server's own zone applies, which the platform runs as UTC.
 */
const LWQL_DATE_TIME_TYPE =
  /^(?:DateTime(?:\(\s*'UTC'\s*\))?|DateTime64(?:\(\s*\d+\s*(?:,\s*'UTC'\s*)?\))?)$/;

/** Whether a declared ClickHouse type can carry an instant. */
export function isLangWatchQLDateTimeParameterType(type: string): boolean {
  return LWQL_DATE_TIME_TYPE.test(type.trim());
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * An instant as ClickHouse reads a `DateTime`: `YYYY-MM-DD HH:MM:SS`, in UTC.
 *
 * Not `toISOString()`. The value goes straight into `query_params`, and
 * ClickHouse's `DateTime` binding is time-zone-naive — a trailing `Z` is not
 * part of the literal it parses. Composed from the UTC getters rather than
 * sliced out of an ISO string so that the zone is a statement of intent instead
 * of a consequence of the format, and so a year outside four digits cannot
 * silently shift every field left.
 *
 * Truncates to the second, which is the resolution a period selector offers;
 * combined with the half-open interval that can only widen the window at its
 * start and narrow it at its end, by under a second either way.
 *
 * @throws when handed an invalid `Date` — a programming error at the boundary
 *   that decoded it, not something a caller can act on.
 */
export function formatLangWatchQLDateTimeParameter(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("A LangWatchQL time window cannot carry an invalid date.");
  }
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}
