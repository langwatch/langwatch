/**
 * The one rule for whether insight shows its bell and its side-menu entry, so the two never
 * disagree: both release flags answered on, `analytics:view`, and a project that is not an
 * aggregate (an aggregate files no insight). False while a flag is still loading.
 * @see modules/insight/specs/insight-inbox.feature
 */

import type { InsightsEntry } from "@langwatch/insight-contract";
import { isAggregateProjectKind } from "@langwatch/project-contract";

import { useInsightHost } from "../model/insight-host.ts";

export function useInsightsShown(): boolean {
  const host = useInsightHost();
  const project = host.project();
  return (
    project !== undefined &&
    !isAggregateProjectKind(project.kind) &&
    host.isEnabled() === true &&
    host.hasPermission("analytics:view")
  );
}

/** What insight lends through `InsightsEntryToken`. */
export const insightsEntry: InsightsEntry = { useIsShown: useInsightsShown };
