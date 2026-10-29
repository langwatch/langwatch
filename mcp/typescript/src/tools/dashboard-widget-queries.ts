import type { DashboardWidgetQueryInput } from "../langwatch-api-dashboard-widgets.js";
import type { WidgetSource } from "../schemas/widget-sources.js";

/** Every query with `sources` set to the list given; as given when no list was named. */
export function withSources({
  queries,
  sources,
}: {
  queries: readonly DashboardWidgetQueryInput[];
  sources: WidgetSource[] | null | undefined;
}): DashboardWidgetQueryInput[] {
  if (sources === undefined) return [...queries];
  return queries.map((query) => ({ ...query, sources }));
}

/** A widget file rarely needs more than a couple of named queries (server bound). */
export const MAX_DASHBOARD_WIDGET_QUERIES = 8;

/** The `{ name: sql }` shorthand or the array form the REST endpoint takes. */
export type DashboardWidgetQueriesInput = DashboardWidgetQueryInput[] | Record<string, string>;

/**
 * Turns the `{ name: sql }` shorthand into the array shape the REST endpoint validates,
 * refusing an empty or oversized set before any request is made.
 */
export function normalizeDashboardWidgetQueries({
  queries,
}: {
  queries: DashboardWidgetQueriesInput;
}): DashboardWidgetQueryInput[] {
  const normalized = Array.isArray(queries)
    ? queries
    : Object.entries(queries).map(([name, sql]) => ({ name, sql }));
  if (normalized.length === 0) {
    throw new Error(
      "Provide at least one named LWQL query in `queries`. Validate each query's SQL first with run_query.",
    );
  }
  if (normalized.length > MAX_DASHBOARD_WIDGET_QUERIES) {
    throw new Error(
      `A widget may declare at most ${MAX_DASHBOARD_WIDGET_QUERIES} queries, got ${normalized.length}.`,
    );
  }
  return normalized;
}
