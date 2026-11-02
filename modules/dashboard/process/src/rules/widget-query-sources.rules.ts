/**
 * A widget query's sources and projects on write (dashboards-v2 AC200j, AC200o, AC207b): what a
 * new widget stores, and how an update's queries keep the lists already stored.
 */
import { DEFAULT_WIDGET_SOURCES } from "@langwatch/analytics-contract";
import type { DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";

/** A new widget's queries: an unset one stores {@link DEFAULT_WIDGET_SOURCES}. */
export function withNewQuerySources(
  queries: readonly DashboardWidgetQuery[],
): DashboardWidgetQuery[] {
  return queries.map((query) => ({
    ...query,
    sources: query.sources ?? [...DEFAULT_WIDGET_SOURCES],
  }));
}

/**
 * An update's queries over the stored ones: a query sent without `sources` or `projects` keeps
 * the list stored under its name, `null` makes it unset, and a stored list that is unset stays
 * unset.
 */
export function mergeQuerySources({
  sent,
  stored,
}: {
  sent: readonly DashboardWidgetQuery[];
  stored: readonly DashboardWidgetQuery[];
}): DashboardWidgetQuery[] {
  return sent.map(({ sources, projects, ...query }) => {
    const before = stored.find((s) => s.name === query.name);
    const keptSources = sources === undefined ? before?.sources : sources;
    const keptProjects = projects === undefined ? before?.projects : projects;

    return {
      ...query,
      ...(keptSources === undefined || keptSources === null ? {} : { sources: keptSources }),
      ...(keptProjects === undefined || keptProjects === null ? {} : { projects: keptProjects }),
    };
  });
}
