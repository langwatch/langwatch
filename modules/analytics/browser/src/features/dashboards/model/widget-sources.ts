/**
 * The line a widget's card shows about the trace origins its queries count, and whether it
 * counts nothing at all (dashboards-v2 AC200, AC200m).
 */

import { effectiveSources } from "@langwatch/analytics-contract";
import { type DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";

import { canFollowSources, PRESENCE_QUERY, readsSourcesParameter } from "./sources-parameter.ts";

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
  // The template-owned presence query reads every origin by design, whatever list it stores.
  const counted = queries.filter((query) => query.name !== PRESENCE_QUERY);
  return (
    counted.length > 0 &&
    counted.every((query) => query.sources?.length === 0 && readsSourcesParameter(query.sql))
  );
}

/**
 * The queries as an update writes them: an unset list says so with `null`, since the server
 * keeps the stored list of a query sent without one. So Undo leaves an unset query unset, its
 * sources and its projects alike (AC200k, AC209).
 */
export function withStoredSources(
  queries: readonly DashboardWidgetQuery[],
): DashboardWidgetQuery[] {
  return queries.map((query) => ({
    ...query,
    sources: query.sources ?? null,
    projects: query.projects ?? null,
  }));
}

/**
 * "Sources: application, langy" for the queries that read the parameter, each query's own list
 * when they differ; "all sources" when none reads it; "" with no query.
 */
export function widgetSourcesLine(allQueries: readonly Sourced[]): string {
  const queries = allQueries.filter((query) => query.name !== PRESENCE_QUERY);
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

/**
 * "Project: Alpha" while no query stores projects (the board's project reads), else "Projects:"
 * and the picked names in order. A project the reader cannot read is not named; "" when none is.
 */
export function widgetProjectsLine({
  queries,
  boardProjectName,
  readable,
}: {
  queries: readonly Pick<DashboardWidgetQuery, "projects">[];
  boardProjectName: string;
  readable: readonly { id: string; name: string }[];
}): string {
  const picked = [...new Set(queries.flatMap((query) => query.projects ?? []))];
  if (picked.length === 0) return boardProjectName === "" ? "" : `Project: ${boardProjectName}`;
  const names = picked.flatMap((id) => readable.find((project) => project.id === id)?.name ?? []);
  if (names.length === 0) return "";

  return `${names.length === 1 ? "Project" : "Projects"}: ${names.join(", ")}`;
}

/**
 * The card's quiet line: its sources and projects, then one (i) line of what the server limited
 * in the run.
 */
export function widgetCardFooter({
  sourcesLine,
  projectsLine,
  limits,
}: {
  sourcesLine: string;
  projectsLine: string;
  /** The limiting messages of the latest runs, joined; "" when the server limited none. */
  limits: string;
}): string {
  return [sourcesLine, projectsLine, limits === "" ? "" : `\u24D8 ${limits}`]
    .filter(Boolean)
    .join(" · ");
}
