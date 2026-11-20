/**
 * The one rule for whether insight draws or reads anything: `release_insights` answered on,
 * `analytics:view`, and a project that is not an aggregate. False while the flag is loading.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { isAggregateProjectKind } from "@langwatch/project-contract";

import { useInsightHost } from "../model/insight-host.ts";

/**
 * Why insight draws nothing: an aggregate project says so on the page; "off" is any other
 * closed condition.
 */
export function useInsightsUnavailable(): "aggregate" | "off" | undefined {
  const host = useInsightHost();
  const project = host.project();
  if (project !== undefined && isAggregateProjectKind(project.kind)) return "aggregate";
  const shown =
    project !== undefined && host.isEnabled() === true && host.hasPermission("analytics:view");
  return shown ? undefined : "off";
}

/** Whether the bell, the Insights page and a board's Daily insights show in this project. */
export function useInsightsShown(): boolean {
  return useInsightsUnavailable() === undefined;
}
