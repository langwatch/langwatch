/**
 * LangWatchQL time-window and granularity vocabulary—has zero imports, read by
 * both browsers and servers; must stay bundle-clean.
 */

/** The window a surface hands a statement, as instants. Half-open: `[start, end)`. */
export interface LangWatchQLTimeWindow {
  readonly start: Date;
  readonly end: Date;
}

/** Inclusive lower bound of the period the surface is showing. */
export const LWQL_PERIOD_START_PARAMETER = "dashboard_context_period_start";

/** Exclusive upper bound of the period the surface is showing. */
export const LWQL_PERIOD_END_PARAMETER = "dashboard_context_period_end";

/**
 * Window parameter names; namespaced to avoid collision with member-defined
 * parameters.
 */
export const LWQL_TIME_WINDOW_PARAMETERS = [
  LWQL_PERIOD_START_PARAMETER,
  LWQL_PERIOD_END_PARAMETER,
] as const;

export type LangWatchQLTimeWindowParameter = (typeof LWQL_TIME_WINDOW_PARAMETERS)[number];

/**
 * Granularity multiplier in seconds; unit fixed because ClickHouse compiles
 * INTERVAL 1 HOUR to a function name, not a bound value.
 */
export const LWQL_PERIOD_GRANULARITY_PARAMETER =
  "dashboard_context_granularity_seconds";

/** Reserved surface parameters: window bounds and granularity. */
export const LWQL_SURFACE_PARAMETERS = [
  LWQL_PERIOD_START_PARAMETER,
  LWQL_PERIOD_END_PARAMETER,
  LWQL_PERIOD_GRANULARITY_PARAMETER,
] as const;

export type LangWatchQLSurfaceParameter = (typeof LWQL_SURFACE_PARAMETERS)[number];

/** Whether a parameter name belongs to the surface rather than the caller. */
export function isLangWatchQLSurfaceParameter(name: string): name is LangWatchQLSurfaceParameter {
  return (LWQL_SURFACE_PARAMETERS as readonly string[]).includes(name);
}

/**
 * Exactly `UInt32`—the smallest unsigned integer that fits all offered steps,
 * no aliases.
 */
const LWQL_GRANULARITY_PARAMETER_TYPE = /^UInt32$/;

/** Whether a declared ClickHouse type can carry the granularity multiplier. */
export function isLangWatchQLGranularityParameterType(type: string): boolean {
  return LWQL_GRANULARITY_PARAMETER_TYPE.test(type.trim());
}

/**
 * Offered granularities in seconds; deliberately sub-day to avoid DST
 * misalignment.
 */
export const LWQL_GRANULARITY_STEPS = [1, 60, 3600] as const;

/** One of the offered steps — the only values any door accepts. */
export type LangWatchQLGranularityStep = (typeof LWQL_GRANULARITY_STEPS)[number];

/** Unit names keyed to steps—adding a step without a name here is a compile error. */
const LWQL_GRANULARITY_STEP_UNITS: Readonly<
  Record<(typeof LWQL_GRANULARITY_STEPS)[number], string>
> = {
  1: "second",
  60: "minute",
  3600: "hour",
};

/**
 * Member-facing step name as noun ("1 minute") or adjective ("1-minute
 * buckets")—single table prevents render/notice drift.
 */
export function describeLangWatchQLGranularityStep(
  seconds: number,
  form: "noun" | "adjective" = "noun",
): string {
  const separator = form === "adjective" ? "-" : " ";
  const unit = (LWQL_GRANULARITY_STEP_UNITS as Readonly<Record<number, string | undefined>>)[
    seconds
  ];

  return unit === undefined
    ? `${seconds}${separator}second${form === "noun" ? "s" : ""}`
    : `1${separator}${unit}`;
}

/**
 * Datapoint bucket ceiling; here so the browser can cite it in notices without
 * pulling in resolve-time-window.ts.
 */
export const LWQL_GRANULARITY_MAX_BUCKETS = 10_000;

/** Whether a parameter name is one the surface owns. */
export function isLangWatchQLTimeWindowParameter(
  name: string,
): name is LangWatchQLTimeWindowParameter {
  return (LWQL_TIME_WINDOW_PARAMETERS as readonly string[]).includes(name);
}

/**
 * Accepted DateTime spellings; case-sensitive, UTC-only, no Date/Nullable
 * aliases to prevent silent truncation or nullability.
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
 * Format instant as ClickHouse `DateTime`: YYYY-MM-DD HH:MM:SS UTC. Not
 * ISO—ClickHouse DateTime binding is zone-naive.
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
