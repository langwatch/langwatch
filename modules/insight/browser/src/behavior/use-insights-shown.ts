/**
 * The one rule for whether insight draws or reads anything: both release flags answered on,
 * `analytics:view`, and a project that is not an aggregate. False while a flag is loading.
 * @see modules/insight/specs/insight-inbox.feature
 */

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
