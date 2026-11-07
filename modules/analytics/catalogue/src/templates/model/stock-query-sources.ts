/**
 * Makes a stock query read {dashboard_context_sources:Array(String)} (dashboards-v2 AC202): the
 * condition goes into the select's own WHERE, never behind a wildcard, which the validator
 * refuses for a member with a gated column. A view with no origin is left as written (AC202f).
 */

import { SOURCE_VIEWS, SOURCES_PLACEHOLDER, TRACE_VIEWS } from "../../model/sources-parameter.ts";

/** Words that can follow a view name without being its alias. */
const NOT_AN_ALIAS = new Set([
  "WHERE",
  "PREWHERE",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "ON",
  "USING",
  "GROUP",
  "ORDER",
  "LIMIT",
  "HAVING",
  "UNION",
  "FINAL",
  "SAMPLE",
  "SETTINGS",
  "FORMAT",
  "ARRAY",
  "ANY",
  "ALL",
  "GLOBAL",
]);

/** Words that end a select's FROM and WHERE region. */
const CLAUSE_END = new Set([
  "GROUP",
  "ORDER",
  "LIMIT",
  "HAVING",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "SETTINGS",
  "WINDOW",
  "QUALIFY",
  "FORMAT",
]);

const PERIOD_START = "{dashboard_context_period_start:DateTime}";
const PERIOD_END = "{dashboard_context_period_end:DateTime}";

/** Comments, strings, quoted names, words, placeholders, brackets, space and any other mark. */
const TOKEN =
  /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.|'')*'|"(?:[^"]|"")*"|`[^`]*`|\{[^}]*\}|[A-Za-z_][\w.]*|[()]|\s+|[\s\S]/g;

type Insertion = { after: number; text: string };

/** Bounds the trace lookup by the period, one window back plus a day, so it prunes by time. */
function lookupBound(sql: string): string {
  if (!sql.includes(PERIOD_START) || !sql.includes(PERIOD_END)) return "";

  return (
    ` AND OccurredAt >= subtractDays(subtractSeconds(${PERIOD_START}, ` +
    `dateDiff('second', ${PERIOD_START}, ${PERIOD_END})), 1)`
  );
}

const isSpace = (token: string) => /^\s+$/.test(token);
const isCode = (token: string) => !isSpace(token) && !/^(--|\/\*)/.test(token);

/** Names a `WITH name AS (` introduces, which a view reference of the same spelling is not. */
function cteNames(code: readonly string[]): Set<string> {
  const names = new Set<string>();
  code.forEach((token, at) => {
    const previous = code[at - 1]?.toUpperCase();
    if (
      code[at + 1]?.toUpperCase() === "AS" &&
      code[at + 2] === "(" &&
      (previous === "WITH" || previous === ",")
    ) {
      names.add(token.toLowerCase());
    }
  });

  return names;
}

/** Where a select's FROM region ends, and the WHERE inside it, as indexes into `code`. */
function regionOf({ code, from }: { code: readonly string[]; from: number }): {
  where: number | undefined;
  end: number;
} {
  let depth = 0;
  let where: number | undefined;
  for (let next = from; next < code.length; next++) {
    const upper = (code[next] ?? "").toUpperCase();
    if (upper === "(") depth++;
    else if (upper === ")" && depth === 0) return { where, end: next };
    else if (upper === ")") depth--;
    else if (depth === 0 && upper === "WHERE" && where === undefined) where = next;
    else if (depth === 0 && CLAUSE_END.has(upper)) return { where, end: next };
    else if (depth === 0 && upper === "JOIN" && where === undefined)
      assertNotJoinedDirectly(code[next + 1]);
  }

  return { where, end: code.length };
}

function assertNotJoinedDirectly(written: string | undefined): void {
  const joined = (written ?? "").replace(/^analytics\./i, "").toLowerCase();
  if ([...SOURCE_VIEWS, ...TRACE_VIEWS].some((view) => view === joined)) {
    throw new Error(`a stock query joins ${joined} directly; select it in a subquery`);
  }
}

/** The view a FROM names and the name its columns go by, or nothing for any other table. */
function referenceAt({
  code,
  position,
  ctes,
}: {
  code: readonly string[];
  position: number;
  ctes: ReadonlySet<string>;
}): { alias: string; isSource: boolean } | undefined {
  const written = (code[position + 1] ?? "").replace(/^analytics\./i, "").toLowerCase();
  const isSource = (SOURCE_VIEWS as readonly string[]).includes(written);
  if (!isSource && !(TRACE_VIEWS as readonly string[]).includes(written)) return undefined;
  if (ctes.has(written)) return undefined;

  const word = code[position + 2 + (code[position + 2]?.toUpperCase() === "AS" ? 1 : 0)];
  const named =
    word !== undefined && /^[A-Za-z_]\w*$/.test(word) && !NOT_AN_ALIAS.has(word.toUpperCase());

  return { alias: named ? word : written, isSource };
}

/** `sql` with every view it names that can follow sources kept to them by its select's WHERE. */
export function readSources(sql: string): string {
  const tokens = sql.match(TOKEN) ?? [];
  const at = tokens.flatMap((token, index) => (isCode(token) ? [index] : []));
  const code = at.map((index) => tokens[index] ?? "");
  const ctes = cteNames(code);
  const bound = lookupBound(sql);
  const insertions: Insertion[] = [];

  code.forEach((token, position) => {
    const view = token.toUpperCase() === "FROM" ? referenceAt({ code, position, ctes }) : undefined;
    if (!view) return;
    const { alias, isSource } = view;
    const predicate = isSource
      ? `${alias}.Source IN ${SOURCES_PLACEHOLDER}`
      : `(${alias}.TenantId, ${alias}.TraceId) IN (SELECT TenantId, TraceId FROM trace_metrics ` +
        `WHERE Source IN ${SOURCES_PLACEHOLDER}${bound})`;
    const { where, end } = regionOf({ code, from: position + 2 });
    const last = at[end - 1] ?? at[position] ?? 0;

    if (where === undefined) insertions.push({ after: last, text: ` WHERE ${predicate}` });
    else {
      insertions.push({ after: at[where] ?? 0, text: ` ${predicate} AND (` });
      insertions.push({ after: last, text: ")" });
    }
  });

  return tokens
    .map((token, index) =>
      insertions
        .filter(({ after }) => after === index)
        .reduce((text, insertion) => text + insertion.text, token),
    )
    .join("");
}
