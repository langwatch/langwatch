/**
 * Reading a widget's LWQL text for the trace origins it names, so a card can say whether the
 * board's Langy setting touches it. Text analysis only: no React, no period maths.
 */

import { LANGY_TRACE_ORIGIN } from "@langwatch/trace-contract";

import { BOARD_UNSCOPED_VIEWS } from "./board-lwql-views.ts";

const COMMENTS = /\/\*[\s\S]*?\*\/|--[^\n]*/g;

/** Langy's traces: column names fold case, values do not, as ClickHouse matches them exactly. */
const LANGY_TRACE_FILTERS = [
  { column: "Origin", value: LANGY_TRACE_ORIGIN },
  { column: "TraceName", value: "langy.turn" },
].map(({ column, value }) => ({
  value: `'${value}'`,
  pattern: new RegExp(
    `(?<!\\bNOT\\s*\\(?\\s*)\\b${column}\\s*(?:==?\\s*'[^']*'|\\s+IN\\s*\\([^)]*\\))`,
    "gi",
  ),
}));

/** Whether a widget's queries ask for Langy's traces with `=` or `IN`; never `!=`, `NOT`. */
export function queriesReadLangyTraces({ sqls }: { sqls: readonly string[] }): boolean {
  return sqls.some((sql) => {
    const code = sql.replace(COMMENTS, " ");
    return LANGY_TRACE_FILTERS.some(({ value, pattern }) =>
      [...code.matchAll(pattern)].some((match) => match[0].includes(value)),
    );
  });
}

const VIEW_READ = /\b(?:FROM|JOIN)\s+(?:\w+\.)?(\w+)/gi;

/** Whether every view the queries name is one origin scoping skips, such as a per-minute rollup. */
export function queriesReadOnlyUnscopedViews({ sqls }: { sqls: readonly string[] }): boolean {
  const views = sqls.flatMap((sql) =>
    [...sql.replace(COMMENTS, " ").matchAll(VIEW_READ)].map((match) => match[1]),
  );
  return views.length > 0 && views.every((view) => BOARD_UNSCOPED_VIEWS.includes(view ?? ""));
}

const ORIGIN_FILTER = /(?<!\bNOT\s*\(?\s*)\bOrigin\s*(?:==?\s*'[^']*'|\s+IN\s*\([^)]*\))/gi;

const WHERE = /\b(?:PRE)?WHERE\b/gi;
const CLAUSE_END = /\b(?:GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING|UNION|SETTINGS)\b/i;
/** A `(` after these opens a grouping, a list or a subquery, never a function call. */
const NOT_A_CALL = /^(?:IN|AND|OR|NOT|WHERE|PREWHERE|FROM|JOIN)$/i;

/** Whether the `(` at `at` follows a function name, read from the characters just before it. */
function opensCall({ code, at }: { code: string; at: number }): boolean {
  let end = at;
  while (end > 0 && /\s/.test(code[end - 1] ?? "")) end--;
  let start = end;
  while (start > 0 && /\w/.test(code[start - 1] ?? "")) start--;
  return start < end && !NOT_A_CALL.test(code.slice(start, end));
}

/** Blanks everything inside a function call's parentheses; plain grouping and `IN (...)` stay. */
function blankCallArguments({ code }: { code: string }): string {
  const calls: boolean[] = [];
  let openCalls = 0;
  let out = "";
  for (let at = 0; at < code.length; at++) {
    const char = code[at] ?? "";
    if (char === "(") {
      const isCall = opensCall({ code, at });
      calls.push(isCall);
      if (isCall) openCalls++;
    }
    out += openCalls > 0 ? " " : char;
    if (char === ")" && calls.pop()) openCalls--;
  }
  return out;
}

/** The filter text of each WHERE clause, up to the next clause. */
function filterClauses({ sql }: { sql: string }): string[] {
  const code = blankCallArguments({ code: sql.replace(COMMENTS, " ") });
  return [...code.matchAll(WHERE)].map((where) => {
    const rest = code.slice((where.index ?? 0) + where[0].length);
    return rest.slice(0, rest.search(CLAUSE_END) >= 0 ? rest.search(CLAUSE_END) : undefined);
  });
}

/**
 * Whether every query pins `Origin` with `=` or `IN` in a WHERE filter, never to Langy's: the
 * board pick is moot. A comparison inside a call (`multiIf`, `if`) is a label, not a filter.
 */
export function queriesPinOriginsWithoutLangy({ sqls }: { sqls: readonly string[] }): boolean {
  return (
    sqls.length > 0 &&
    sqls.every((sql) => {
      const pins = filterClauses({ sql }).flatMap((clause) => [...clause.matchAll(ORIGIN_FILTER)]);
      return pins.length > 0 && pins.every(([pin]) => !pin.includes(`'${LANGY_TRACE_ORIGIN}'`));
    })
  );
}

/** Whether the board's Langy setting changes nothing here: unscoped-views-only or origin-pinned. */
export function queriesIgnoreBoardOrigins({ sqls }: { sqls: readonly string[] }): boolean {
  return queriesReadOnlyUnscopedViews({ sqls }) || queriesPinOriginsWithoutLangy({ sqls });
}
