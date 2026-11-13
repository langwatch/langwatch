/**
 * ClickHouse reads a date-time parameter only as `YYYY-MM-DD hh:mm:ss` or Unix seconds, so
 * `2026-11-01T00:00:00Z` fails with BAD_QUERY_PARAMETER. Unix seconds keep the same moment
 * whatever timezone the placeholder declares.
 */
import { Temporal } from "@langwatch/time";

/** An ISO 8601 date-time that names its offset: `Z` or `±hh:mm`. */
const ISO_INSTANT_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Every `{name:Type}` placeholder; group 1 is the name, group 2 the declared type. */
const PLACEHOLDER = /\{\s*([A-Za-z_]\w*)\s*:\s*([^{}]*)\}/g;

/** A date-time type under any `Nullable`/`LowCardinality` wrappers; group 1 says which. */
const DATE_TIME_TYPE = /^(?:(?:Nullable|LowCardinality)\(\s*)*(DateTime64|DateTime)(?!\w)/i;

/** What opens a string literal or a quoted identifier, where ClickHouse places no parameter. */
const QUOTES = new Set(["'", '"', "`"]);

const NANOSECONDS_PER_SECOND = 1_000_000_000n;

/** The end of the quoted run opened at `start`, honouring `''` and backslash escapes. */
function quotedEnd({ sql, start }: { sql: string; start: number }): number {
  const quote = sql[start];
  let at = start + 1;
  while (at < sql.length) {
    if (sql[at] === "\\") at += 2;
    else if (sql[at] === quote && sql[at + 1] === quote) at += 2;
    else if (sql[at] === quote) return at + 1;
    else at += 1;
  }
  return sql.length;
}

/** The end of the `/* … *\/` comment opened at `start`; ClickHouse nests them. */
function blockCommentEnd({ sql, start }: { sql: string; start: number }): number {
  let depth = 0;
  let at = start;
  while (at < sql.length) {
    if (sql.startsWith("/*", at)) {
      depth += 1;
      at += 2;
    } else if (sql.startsWith("*/", at)) {
      depth -= 1;
      at += 2;
      if (depth === 0) return at;
    } else at += 1;
  }
  return sql.length;
}

/** The statement with every quoted run and comment blanked, so only real placeholders remain. */
function withoutQuotedTextOrComments(sql: string): string {
  let kept = "";
  let at = 0;
  while (at < sql.length) {
    let end = at;
    if (QUOTES.has(sql[at] ?? "")) end = quotedEnd({ sql, start: at });
    else if (sql.startsWith("/*", at)) end = blockCommentEnd({ sql, start: at });
    else if (sql.startsWith("--", at) || sql[at] === "#") {
      const newline = sql.indexOf("\n", at);
      end = newline === -1 ? sql.length : newline;
    }
    if (end === at) {
      kept += sql[at];
      at += 1;
    } else {
      kept += " ";
      at = end;
    }
  }
  return kept;
}

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
  const kindsByName = new Map<string, Set<string>>();
  for (const [, name, type] of withoutQuotedTextOrComments(sql).matchAll(PLACEHOLDER)) {
    if (name === undefined || type === undefined) continue;
    const kind = DATE_TIME_TYPE.exec(type.trim())?.[1]?.toLowerCase() ?? "other";
    kindsByName.set(name, (kindsByName.get(name) ?? new Set()).add(kind));
  }
  const bound = { ...parameters };
  for (const [name, kinds] of kindsByName) {
    // One name declared two ways: either text would lose meaning for one, so ClickHouse decides.
    if (kinds.size > 1) continue;
    const [kind] = kinds;
    if (kind === "other") continue;
    const value = bound[name];
    if (typeof value !== "string" || !ISO_INSTANT_WITH_OFFSET.test(value.trim())) continue;
    bound[name] = unixSecondsText({ value: value.trim(), subSecond: kind === "datetime64" });
  }
  return bound;
}
