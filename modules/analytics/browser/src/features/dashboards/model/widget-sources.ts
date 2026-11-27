/**
 * The line a widget's card shows about the trace origins its queries count, and whether it
 * counts nothing at all (dashboards-v2 AC200, AC200m).
 */

import {
  DEFAULT_WIDGET_SOURCES,
  effectiveSources,
  readsSourcesParameter,
  TRACE_SOURCES,
  type TraceSource,
} from "@langwatch/analytics-contract";
import { type DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";

import { canFollowSources, PRESENCE_QUERY } from "./sources-parameter.ts";

type Sourced = Pick<DashboardWidgetQuery, "name" | "sources" | "sql">;

/**
 * The template-owned presence query, which reads every origin by design. A query someone named
 * `present` that reads the sources parameter is theirs, and keeps the list it stores.
 */
function isPresenceQuery(query: Sourced): boolean {
  return query.name === PRESENCE_QUERY && !readsSourcesParameter(query.sql);
}

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
  const counted = queries.filter((query) => !isPresenceQuery(query));
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
 * The sources a card's run names: what the query stores, null for the default (AC200f). The
 * presence query and one over views with no origin name none, so a list stored on them raises
 * no note that the sources were ignored (AC202i).
 */
export function runSources(query: Sourced): readonly TraceSource[] | null {
  if (isPresenceQuery(query) || !canFollowSources(query.sql)) return null;
  return query.sources ?? null;
}

/**
 * "Sources: application, langy" for the queries that read the parameter, each query's own list
 * when they differ; "all sources" when none reads it; "" with no query.
 */
export function widgetSourcesLine(allQueries: readonly Sourced[]): string {
  const queries = allQueries.filter((query) => !isPresenceQuery(query));
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

/** Each source as a card names it to a reader. */
const PLAIN_SOURCE_NAMES: Readonly<Record<TraceSource, string>> = {
  application: "your app",
  simulation: "simulated tests",
  evaluation: "automatic checks",
  sample: "sample data",
  coding_agent: "coding agents",
  ai_tool: "AI tools",
  gateway: "the AI gateway",
  workflow: "workflows",
  playground: "the playground",
  langy: "Langy",
  other: "other",
};

/** The card line of a widget that counts every source. */
export const EVERY_SOURCE_CARD_LINE = "Counts everything, tests included.";

/** The card line of a widget with no source picked. */
export const NO_SOURCES_CARD_LINE = "Pick at least one source.";

/** "your app, Langy and the AI gateway", or "everything" when the list holds every source. */
function plainSources(sources: readonly TraceSource[]): string {
  if (TRACE_SOURCES.every((source) => sources.includes(source))) return "everything";
  const names = sources.map((source) => PLAIN_SOURCE_NAMES[source]);
  if (names.length <= 1) return names[0] ?? "nothing";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const isDefault = (sources: readonly TraceSource[]) =>
  sources.length === DEFAULT_WIDGET_SOURCES.length &&
  sources.every((source) => DEFAULT_WIDGET_SOURCES.includes(source));

/**
 * The sources line a card shows, in plain names: only one that changes how the figures read. A
 * widget counting just the default sources, or reading only views that keep no origin, shows
 * none (AC240, AC240b); the editor keeps the full line from {@link widgetSourcesLine}.
 */
export function widgetCardSourcesLine(allQueries: readonly Sourced[]): string {
  const queries = allQueries.filter((query) => !isPresenceQuery(query));
  if (queries.length === 0) return "";
  if (picksNoSources(queries)) return NO_SOURCES_CARD_LINE;
  // A query over origin-keeping views that ignores the parameter counts every source.
  const named = queries
    .filter((query) => canFollowSources(query.sql))
    .map((query) => ({
      name: query.name,
      sources: readsSourcesParameter(query.sql) ? effectiveSources(query.sources) : TRACE_SOURCES,
    }));
  if (named.length === 0) return "";
  const lists = new Set(named.map(({ sources }) => plainSources(sources)));
  if (lists.size === 1) {
    const sources = named[0]?.sources ?? [];
    if (isDefault(sources)) return "";
    const list = plainSources(sources);
    return list === "everything" ? EVERY_SOURCE_CARD_LINE : `Counts: ${list}`;
  }
  return `Counts: ${named.map(({ name, sources }) => `${name}: ${plainSources(sources)}`).join(" · ")}`;
}

/**
 * The picked projects, "Project: Alpha" or "Projects: Beta, Alpha" in order, only where they
 * differ from what the board reads: its project, or every project (`boardProjectId` null). A
 * project the reader cannot read is not named; "" when none is.
 */
export function widgetProjectsLine({
  queries,
  boardProjectId,
  readable,
}: {
  queries: readonly Pick<DashboardWidgetQuery, "projects">[];
  boardProjectId: string | null;
  readable: readonly { id: string; name: string }[];
}): string {
  const picked = [...new Set(queries.flatMap((query) => query.projects ?? []))];
  if (picked.length === 0) return "";
  if (picked.length === 1 && picked[0] === boardProjectId) return "";
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
