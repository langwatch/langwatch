/**
 * Whether a query's SQL reads {dashboard_context_sources:Array(String)}, and which views it
 * names that keep no origin. A query that does not read the parameter counts every origin
 * (dashboards-v2 AC204), and one that reads only origin-less views cannot follow sources (AC202f).
 */

export const SOURCES_PLACEHOLDER = "{dashboard_context_sources:Array(String)}";

/** Views that keep an origin, or reach one through their trace. */
export const VIEWS_WITH_ORIGIN = [
  "trace_metrics",
  "evaluation_metrics",
  "traces",
  "spans",
  "evaluations",
  "annotations",
] as const;

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

/** The views a query reads that keep no origin and cannot reach one through a trace. */
export function viewsWithoutOrigin(sql: string): string[] {
  const named = [...codeOf(sql).matchAll(/\b(?:FROM|JOIN)\s+(?:analytics\.)?([a-z_]+)/gi)].map(
    (match) => match[1] ?? "",
  );

  return [...new Set(named)].filter(
    (view) => !(VIEWS_WITH_ORIGIN as readonly string[]).includes(view),
  );
}

/** Whether a query can follow sources at all: it names a view that keeps an origin. */
export function canFollowSources(sql: string): boolean {
  const named = [...codeOf(sql).matchAll(/\b(?:FROM|JOIN)\s+(?:analytics\.)?([a-z_]+)/gi)];

  return named.some((match) => (VIEWS_WITH_ORIGIN as readonly string[]).includes(match[1] ?? ""));
}
