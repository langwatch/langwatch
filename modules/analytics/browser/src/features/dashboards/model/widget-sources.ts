/**
 * The line a widget's card shows about the trace origins its queries count, and whether it
 * counts nothing at all (dashboards-v2 AC200, AC200m).
 */

import { effectiveSources } from "@langwatch/analytics-contract";
import { type DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";

type Sourced = Pick<DashboardWidgetQuery, "name" | "sources">;

/** Every query's list is empty: the widget counts no trace, so nothing is run. */
export function picksNoSources(queries: readonly Sourced[]): boolean {
  return queries.length > 0 && queries.every((query) => query.sources?.length === 0);
}

/**
 * The queries as an update writes them: an unset query says so with `null`, since the server
 * keeps the stored list of a query sent without one. So Undo leaves an unset query unset (AC200k).
 */
export function withStoredSources(
  queries: readonly DashboardWidgetQuery[],
): DashboardWidgetQuery[] {
  return queries.map((query) => ({ ...query, sources: query.sources ?? null }));
}

/** "Sources: application, langy"; each query's own list when they differ; "" with no query. */
export function widgetSourcesLine(queries: readonly Sourced[]): string {
  if (queries.length === 0) return "";
  if (picksNoSources(queries)) return "No sources picked";
  const named = queries.map((query) => ({
    name: query.name,
    list: effectiveSources(query.sources).join(", ") || "none",
  }));
  const lists = new Set(named.map(({ list }) => list));
  if (lists.size === 1) return `Sources: ${named[0]?.list}`;
  return `Sources: ${named.map(({ name, list }) => `${name}: ${list}`).join(" · ")}`;
}
