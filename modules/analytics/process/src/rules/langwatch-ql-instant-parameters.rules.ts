/**
 * ClickHouse reads a date-time parameter only as `YYYY-MM-DD hh:mm:ss` or Unix seconds, so
 * `2026-11-01T00:00:00Z` fails with BAD_QUERY_PARAMETER. Unix seconds keep the same moment
 * whatever timezone the placeholder declares.
 */
import { Temporal } from "@langwatch/time";

/** An ISO 8601 date-time that names its offset: `Z` or `±hh:mm`. */
const ISO_INSTANT_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** A `{name:DateTime…}` placeholder, optionally `Nullable(...)`; group 2 says which type. */
const DATE_TIME_PLACEHOLDER =
  /\{\s*([A-Za-z_]\w*)\s*:\s*(?:Nullable\(\s*)?(DateTime64|DateTime)(?![A-Za-z0-9_])/g;

const NANOSECONDS_PER_SECOND = 1_000_000_000n;

/** Unix seconds as ClickHouse reads them: whole for `DateTime`, nine decimals for `DateTime64`. */
function unixSecondsText({ value, subSecond }: { value: string; subSecond: boolean }): string {
  let nanoseconds: bigint;
  try {
    nanoseconds = Temporal.Instant.from(value).epochNanoseconds;
  } catch {
    // Shaped like an instant but not one (month 13): ClickHouse refuses it as sent.
    return value;
  }
  if (nanoseconds < 0n) return value;
  const seconds = nanoseconds / NANOSECONDS_PER_SECOND;
  if (!subSecond) return seconds.toString();
  const fraction = (nanoseconds % NANOSECONDS_PER_SECOND).toString().padStart(9, "0");
  return `${seconds}.${fraction}`;
}

/**
 * The values with each ISO instant bound to a date-time placeholder of `sql` rewritten as Unix
 * seconds. Any other value is left as sent: one ClickHouse already reads keeps its meaning, and
 * one it cannot read is still refused as `lwql_parameter_invalid`.
 */
export function bindLangWatchQLInstantParameters({
  sql,
  parameters,
}: {
  sql: string;
  parameters: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const bound = { ...parameters };
  for (const [, name, kind] of sql.matchAll(DATE_TIME_PLACEHOLDER)) {
    if (name === undefined) continue;
    const value = bound[name];
    if (typeof value !== "string" || !ISO_INSTANT_WITH_OFFSET.test(value.trim())) continue;
    bound[name] = unixSecondsText({ value: value.trim(), subSecond: kind === "DateTime64" });
  }
  return bound;
}
