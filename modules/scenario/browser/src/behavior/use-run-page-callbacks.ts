import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { useMemo } from "react";

import { runPageAddress } from "./suites/use-suite-routing.ts";
import type { RunSettledCallbacks } from "./use-drawer-run-callbacks.ts";

/**
 * Callbacks that keep Run Again on the standalone run page: a settled run
 * opens at its own set, batch and run address.
 */
export function useRunPageCallbacks(): RunSettledCallbacks {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  return useMemo(() => {
    const showRun = (result: { scenarioRunId: string; setId: string; batchRunId?: string }) => {
      if (!project?.slug || !result.batchRunId) return;
      void router.push(
        runPageAddress({
          projectSlug: project.slug,
          setId: result.setId,
          batchRunId: result.batchRunId,
          scenarioRunId: result.scenarioRunId,
        }),
      );
    };
    return { onRunComplete: showRun, onRunFailed: showRun };
  }, [router, project?.slug]);
}
