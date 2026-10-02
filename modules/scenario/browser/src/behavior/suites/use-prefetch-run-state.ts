/**
 * Warms the run detail drawer's getRunState query on hover/focus so the drawer opens
 * with data already in the cache instead of a loading state.
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { scenarioClient } from "@langwatch/scenario-client";
import { useCallback } from "react";

const PREFETCH_STALE_TIME_MS = 5000;

export function usePrefetchRunState() {
  const { project } = useOrganizationTeamProject();
  const utils = scenarioClient.useUtils();

  return useCallback(
    (scenarioRunId: string) => {
      if (!project?.id || !scenarioRunId) return;
      void utils.scenarios.getRunState.prefetch(
        { projectId: project.id, scenarioRunId },
        { staleTime: PREFETCH_STALE_TIME_MS },
      );
    },
    [project?.id, utils],
  );
}
