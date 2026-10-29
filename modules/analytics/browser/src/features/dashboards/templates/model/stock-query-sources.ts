/**
 * Makes a stock query read {dashboard_context_sources:Array(String)} (dashboards-v2 AC202): a view
 * that keeps an origin, or reaches one through its trace, is read kept to the bound sources.
 * A view with neither is left as written (AC202f).
 */

import { SOURCES_PLACEHOLDER } from "../../model/sources-parameter.ts";

/** Views with the normalised `Source` column. */
const SOURCE_VIEWS = ["trace_metrics", "evaluation_metrics"] as const;

/** Views keyed by the trace that carries the origin, reached through `trace_metrics`. */
const TRACE_VIEWS = ["traces", "spans", "evaluations", "annotations"] as const;

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

const ALL_VIEWS = [...SOURCE_VIEWS, ...TRACE_VIEWS].join("|");
const VIEW_REFERENCE = new RegExp(
  `\\b(FROM|JOIN)(\\s+)(?:analytics\\.)?(${ALL_VIEWS})\\b(?:\\s+(?:AS\\s+)?([A-Za-z_]\\w*))?`,
  "g",
);

const PERIOD_START = "{dashboard_context_period_start:DateTime}";
const PERIOD_END = "{dashboard_context_period_end:DateTime}";

/** Bounds the trace lookup by the period, one window back plus a day, so it prunes by time. */
function lookupBound(sql: string): string {
  if (!sql.includes(PERIOD_START) || !sql.includes(PERIOD_END)) return "";

  return (
    ` AND OccurredAt >= subtractDays(subtractSeconds(${PERIOD_START}, ` +
    `dateDiff('second', ${PERIOD_START}, ${PERIOD_END})), 1)`
  );
}

/** `sql` with every view it names that can follow sources read as that view kept to them. */
export function readSources(sql: string): string {
  const bound = lookupBound(sql);
  const byTrace =
    `(TenantId, TraceId) IN (SELECT TenantId, TraceId FROM trace_metrics ` +
    `WHERE Source IN ${SOURCES_PLACEHOLDER}${bound})`;

  return sql.replace(VIEW_REFERENCE, (...groups: (string | undefined)[]) => {
    const [, keyword, space, view = "", word] = groups;
    const alias = word !== undefined && !NOT_AN_ALIAS.has(word.toUpperCase()) ? word : view;
    const rest = word !== undefined && NOT_AN_ALIAS.has(word.toUpperCase()) ? ` ${word}` : "";
    const predicate = (SOURCE_VIEWS as readonly string[]).includes(view)
      ? `Source IN ${SOURCES_PLACEHOLDER}`
      : byTrace;

    return `${keyword}${space}(SELECT * FROM ${view} WHERE ${predicate}) AS ${alias}${rest}`;
  });
}
