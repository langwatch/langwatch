/**
 * The line a widget's card shows about the trace origins its queries count, and whether it
 * counts nothing at all (dashboards-v2 AC200, AC200m).
 */

import { effectiveSources } from "@langwatch/analytics-contract";
import { type DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";

import { canFollowSources, readsSourcesParameter } from "./sources-parameter.ts";

type Sourced = Pick<DashboardWidgetQuery, "name" | "sources" | "sql">;

/** The card line when no query reads the parameter but a view could follow it (AC204). */
export const ALL_SOURCES_LINE = "Sources: all sources";

/** The card line when every view a widget reads keeps no origin (AC202f). */
export const SOURCES_DO_NOT_APPLY_LINE =
  "Sources don't apply: this widget reads a view that keeps no origin";

/**
 * Every query that reads the sources parameter has an empty list: the widget counts no trace,
 * so nothing is run. A query that ignores the parameter counts every origin whatever it stores.
 */
export function picksNoSources(queries: readonly Sourced[]): boolean {
  return (
    queries.length > 0 &&
    queries.every((query) => query.sources?.length === 0 && readsSourcesParameter(query.sql))
  );
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

/**
 * "Sources: application, langy" for the queries that read the parameter, each query's own list
 * when they differ; "all sources" when none reads it; "" with no query.
 */
export function widgetSourcesLine(queries: readonly Sourced[]): string {
  if (queries.length === 0) return "";
  if (picksNoSources(queries)) return "No sources picked";
  const following = queries.filter((query) => readsSourcesParameter(query.sql));
  if (following.length === 0) {
    return queries.some((query) => canFollowSources(query.sql))
      ? ALL_SOURCES_LINE
      : SOURCES_DO_NOT_APPLY_LINE;
  }
  const named = following.map((query) => ({
    name: query.name,
    list: effectiveSources(query.sources).join(", ") || "none",
  }));
  const lists = new Set(named.map(({ list }) => list));
  if (lists.size === 1) return `Sources: ${named[0]?.list}`;
  return `Sources: ${named.map(({ name, list }) => `${name}: ${list}`).join(" · ")}`;
}

/** The card's quiet line: its sources, then one (i) line of what the server limited in the run. */
export function widgetCardFooter({
  sourcesLine,
  limits,
}: {
  sourcesLine: string;
  /** The limiting messages of the latest runs, joined; "" when the server limited none. */
  limits: string;
}): string {
  return [sourcesLine, limits === "" ? "" : `\u24D8 ${limits}`].filter(Boolean).join(" · ");
}
