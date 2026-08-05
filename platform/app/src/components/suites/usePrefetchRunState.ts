/**
 * Warms the run detail drawer's getRunState query on hover/focus so the
 * drawer opens with data already in the cache instead of a loading state.
 *
 * The short staleTime stops the drawer from immediately re-fetching what the
 * prefetch just loaded within the hover→click window; after that the drawer's
 * own status-gated polling takes over.
 */

import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const PREFETCH_STALE_TIME_MS = 5000;

export function usePrefetchRunState() {
  const { project } = useOrganizationTeamProject();
  const utils = api.useContext();

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
