/**
 * Whether a query's SQL reads {dashboard_context_sources:Array(String)}, and whether it names a
 * view that can follow it. A query that does not read the parameter counts every origin
 * (dashboards-v2 AC204), and one that reads only origin-less views cannot follow sources (AC202f).
 */

import { LWQL_SOURCES_PARAMETER } from "@langwatch/analytics-contract";

export const SOURCES_PLACEHOLDER = `{${LWQL_SOURCES_PARAMETER}:Array(String)}`;

/** The presence query tells a quiet period from a source never set up: it reads every origin. */
export const PRESENCE_QUERY = "present";

/** Views with the normalised `Source` column. */
export const SOURCE_VIEWS = ["trace_metrics", "evaluation_metrics"] as const;

/** Views keyed by the trace that carries the origin, reached through `trace_metrics`. */
export const TRACE_VIEWS = ["traces", "spans", "evaluations", "annotations"] as const;

/** Views that keep an origin, or reach one through their trace. */
export const VIEWS_WITH_ORIGIN: readonly string[] = [...SOURCE_VIEWS, ...TRACE_VIEWS];

/** The SQL without its comments, and with its string literals emptied. */
function codeOf(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
}

/** Whether the SQL reads the placeholder in an expression: not in a comment or a literal. */
export function readsSourcesParameter(sql: string): boolean {
  return codeOf(sql).includes(SOURCES_PLACEHOLDER);
}

/** The distinct views a query names after FROM or JOIN, in the order first named. */
export function namedViews(sql: string): string[] {
  const named = [...codeOf(sql).matchAll(/\b(?:FROM|JOIN)\s+(?:analytics\.)?([a-z_]+)/gi)].map(
    (match) => match[1] ?? "",
  );

  return [...new Set(named)];
}

/** Whether a query can follow sources at all: it names a view that keeps an origin. */
export function canFollowSources(sql: string): boolean {
  return namedViews(sql).some((view) => VIEWS_WITH_ORIGIN.includes(view));
}
