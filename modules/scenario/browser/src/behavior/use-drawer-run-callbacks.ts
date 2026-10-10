import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { useCallback } from "react";

type RunSettledResult = { scenarioRunId: string; setId: string; batchRunId?: string };

/** What happens once a started run completes or fails. */
export type RunSettledCallbacks = {
  onRunComplete: (result: RunSettledResult) => void;
  onRunFailed: (result: RunSettledResult) => void;
};

/**
 * Returns callbacks that navigate to the simulations page (runs list) when a scenario
 * run completes or fails.
 */
export function useDrawerRunCallbacks(): RunSettledCallbacks {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const onRunComplete = useCallback(
    (result: RunSettledResult) => {
      // Transient null during initial auth/project resolve. By the time a
      // user can click Run Again from a drawer, project.slug is present.
      if (!project?.slug) return;
      const query = result.batchRunId ? `?pendingBatch=${result.batchRunId}` : "";
      void router.push(`/${project.slug}/simulations${query}`);
    },
    [router, project?.slug],
  );

  return { onRunComplete, onRunFailed: onRunComplete };
}
