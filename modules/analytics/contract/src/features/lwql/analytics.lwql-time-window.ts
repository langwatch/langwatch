/**
 * LangWatchQL time-window and granularity vocabulary—has zero imports, read by
 * both browsers and servers; must stay bundle-clean.
 */

/** The window a surface hands a statement, as UTC ISO instants. Half-open: `[start, end)`. */
export interface LangWatchQLTimeWindow {
  readonly start: string;
  readonly end: string;
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
export const LWQL_PERIOD_GRANULARITY_PARAMETER = "dashboard_context_granularity_seconds";

/** The trace origins a run is bound to (`Array(String)`), set by the surface from `sources`. */
export const LWQL_SOURCES_PARAMETER = "dashboard_context_sources";

/** SQL without its comments and with its string literals emptied: what a statement executes. */
export function lwqlExecutedText(sql: string): string {
  // One left-to-right pass, so `--` inside a literal and a quote inside a comment stay inert.
  return sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*|'(?:[^'\\]|\\.|'')*'/g, (token) =>
    token.startsWith("'") ? "''" : " ",
  );
}

/** The sources placeholder, with the spacing inside its type the server's type check allows. */
const SOURCES_PLACEHOLDER = new RegExp(
  `\\{${LWQL_SOURCES_PARAMETER}:\\s*Array\\(\\s*String\\s*\\)\\s*\\}`,
);

/** Whether a statement reads the sources placeholder in an expression, not a comment or literal. */
export function readsSourcesParameter(sql: string): boolean {
  return SOURCES_PLACEHOLDER.test(lwqlExecutedText(sql));
}

/** The projects a run reads (`Array(String)`), set by the surface from `projects`. */
export const LWQL_PROJECTS_PARAMETER = "dashboard_context_projects";

/** The reserved names that carry a list of strings rather than an instant or a step. */
export const LWQL_LIST_PARAMETERS = [LWQL_SOURCES_PARAMETER, LWQL_PROJECTS_PARAMETER] as const;

export type LangWatchQLListParameter = (typeof LWQL_LIST_PARAMETERS)[number];

/**
 * The viewer's IANA time zone (`String`), set by the surface from `timeZone`, so a statement can
 * bucket and label by the reader's clock. "UTC" when the surface sends none.
 */
export const LWQL_TIME_ZONE_PARAMETER = "dashboard_context_timezone";

/** The zone a run is bound to when the surface names none. */
export const LWQL_DEFAULT_TIME_ZONE = "UTC";

/** The characters an IANA zone name is made of; quotes, spaces and braces never pass. */
const IANA_TIME_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,3}$/;

/** Whether a value is an IANA zone name this runtime knows, such as "America/Los_Angeles". */
export function isLangWatchQLTimeZone(value: string): boolean {
  if (value.length > 64 || !IANA_TIME_ZONE_NAME.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Exactly `String`: the zone binds as written. */
const LWQL_TIME_ZONE_PARAMETER_TYPE = /^String$/;

/** Whether a declared ClickHouse type can carry the time zone. */
export function isLangWatchQLTimeZoneParameterType(type: string): boolean {
  return LWQL_TIME_ZONE_PARAMETER_TYPE.test(type.trim());
}

/** Reserved surface parameters: window bounds, granularity, sources, projects and time zone. */
export const LWQL_SURFACE_PARAMETERS = [
  LWQL_PERIOD_START_PARAMETER,
  LWQL_PERIOD_END_PARAMETER,
  LWQL_PERIOD_GRANULARITY_PARAMETER,
  ...LWQL_LIST_PARAMETERS,
  LWQL_TIME_ZONE_PARAMETER,
] as const;

/** Whether a parameter name is one of the two that carry a list. */
export function isLangWatchQLListParameter(name: string): name is LangWatchQLListParameter {
  return (LWQL_LIST_PARAMETERS as readonly string[]).includes(name);
}

/** Exactly `Array(String)`: no `Nullable`, no `LowCardinality`, so a list binds as written. */
const LWQL_LIST_PARAMETER_TYPE = /^Array\(\s*String\s*\)$/;

/** Whether a declared ClickHouse type can carry a list of strings. */
export function isLangWatchQLListParameterType(type: string): boolean {
  return LWQL_LIST_PARAMETER_TYPE.test(type.trim());
}

export type LangWatchQLSurfaceParameter = (typeof LWQL_SURFACE_PARAMETERS)[number];

/** Whether a parameter name belongs to the surface rather than the caller. */
export function isLangWatchQLSurfaceParameter(name: string): name is LangWatchQLSurfaceParameter {
  return (LWQL_SURFACE_PARAMETERS as readonly string[]).includes(name);
}

/**
 * Exactly `UInt32`—the smallest unsigned integer that fits all accepted steps,
 * no aliases.
 */
const LWQL_GRANULARITY_PARAMETER_TYPE = /^UInt32$/;

/** Whether a declared ClickHouse type can carry the granularity multiplier. */
export function isLangWatchQLGranularityParameterType(type: string): boolean {
  return LWQL_GRANULARITY_PARAMETER_TYPE.test(type.trim());
}

/**
 * The sub-day steps the workbench and legacy dashboard pickers offer, and the
 * ladder a coarsening overflow climbs. Day and week are accepted separately
 * below so those surfaces keep exactly the choices they had.
 */
export const LWQL_GRANULARITY_STEPS = [1, 60, 3600] as const;

/** One of the sub-day offered steps. */
export type LangWatchQLGranularityStep = (typeof LWQL_GRANULARITY_STEPS)[number];

/**
 * Every step any door accepts: the sub-day ones plus one day and one week, the
 * Dashboards grain choices (dashboards-v1.feature, AC13). Buckets are UTC unless
 * the statement reads the time zone.
 */
export const LWQL_ACCEPTED_GRANULARITY_STEPS = [
  ...LWQL_GRANULARITY_STEPS,
  86_400,
  604_800,
] as const;

/**
 * How far dashboard buckets sit from the epoch, a Thursday, so a week starts on Monday. Every
 * accepted step below a week divides it, so only week buckets move.
 */
export const LWQL_BUCKET_ALIGNMENT_SECONDS = 345_600;

/** Steps this long or longer bucket on the reader's wall clock; shorter ones on the instant. */
export const LWQL_WALL_CLOCK_GRANULARITY_SECONDS = 86_400;

/**
 * The start of the bucket `column` falls in, as a UTC `DateTime`. With a `timeZone` placeholder a
 * day or longer step floors on that zone's wall clock (a day starts at local midnight across DST)
 * and a shorter one on the instant (a repeated hour stays two). `granularity` is SQL seconds.
 */
export function lwqlBucketStartSql({
  column,
  granularity,
  timeZone,
}: {
  column: string;
  granularity: string;
  timeZone?: string;
}): string {
  const shift = LWQL_BUCKET_ALIGNMENT_SECONDS;
  const floor = (time: string) =>
    `addSeconds(toStartOfInterval(subtractSeconds(${time}, ${shift}), INTERVAL ${granularity} SECOND), ${shift})`;
  if (timeZone === undefined) return floor(column);
  const wall = `toDateTime(toString(toDateTime(${column}), ${timeZone}), 'UTC')`;
  const wallFloor = `toTimeZone(toDateTime(toString(${floor(wall)}), ${timeZone}), 'UTC')`;

  return (
    `if(${granularity} >= ${LWQL_WALL_CLOCK_GRANULARITY_SECONDS}, ${wallFloor}, ` +
    `toDateTime(${floor(column)}, 'UTC'))`
  );
}

/** One of the accepted steps: the only values any door accepts. */
export type LangWatchQLAcceptedGranularityStep = (typeof LWQL_ACCEPTED_GRANULARITY_STEPS)[number];

/** Unit names keyed to steps—adding a step without a name here is a compile error. */
const LWQL_GRANULARITY_STEP_UNITS: Readonly<Record<LangWatchQLAcceptedGranularityStep, string>> = {
  1: "second",
  60: "minute",
  3600: "hour",
  86_400: "day",
  604_800: "week",
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

/** A UTC ISO instant with a four-digit year, as the window schema emits it. */
const LWQL_UTC_ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * Format a UTC ISO instant as ClickHouse `DateTime`: YYYY-MM-DD HH:MM:SS. Not
 * ISO—ClickHouse DateTime binding is zone-naive.
 */
export function formatLangWatchQLDateTimeParameter(instant: string): string {
  if (!LWQL_UTC_ISO_INSTANT.test(instant)) {
    throw new Error("A LangWatchQL time window cannot carry an invalid date.");
  }
  return `${instant.slice(0, 10)} ${instant.slice(11, 19)}`;
}
