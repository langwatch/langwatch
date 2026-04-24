import { useCallback } from "react";
import { useRouter } from "~/utils/compat/next-router";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

/**
 * Returns callbacks that navigate to the simulations page (runs list)
 * when a scenario run completes or fails.
 *
 * Mirrors the navigation behavior already used by ScenarioFormDrawer on
 * its initial Save-and-Run, so "Run Again" from a run-detail drawer
 * lands the user on the runs list with the new batch highlighted
 * instead of stacking another drawer on the same page.
 */
export function useDrawerRunCallbacks() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const onRunComplete = useCallback(
    (result: { scenarioRunId: string; batchRunId?: string }) => {
      if (!project?.slug) return;
      const query = result.batchRunId
        ? `?pendingBatch=${result.batchRunId}`
        : "";
      void router.push(`/${project.slug}/simulations${query}`);
    },
    [router, project?.slug],
  );

  return { onRunComplete, onRunFailed: onRunComplete };
}
