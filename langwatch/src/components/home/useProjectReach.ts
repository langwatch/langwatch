import type { ProjectReach } from "~/features/langy/logic/langyHomeSuggestions";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export interface ProjectReachResult extends ProjectReach {
  /** True until we know, so nothing offers asks it may have to withdraw. */
  isLoading: boolean;
  /** No traces yet: the home page leads with setup rather than figures. */
  isNewProject: boolean;
}

/**
 * How far into the product this project has got.
 *
 * Reads the SAME query the onboarding checklist does, deliberately: React
 * Query dedupes it, so asking here costs nothing, and the checklist and the
 * home page's asks can never disagree about whether the project has data.
 *
 * `simulations` counts as experiments alongside datasets, because both are
 * things a "compare my last two runs" ask can actually land on.
 */
export function useProjectReach(): ProjectReachResult {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const { data, isLoading } = api.integrationsChecks.getCheckStatus.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  // The project row in hand already answers "has a trace ever arrived" —
  // the collector flips `firstMessage` on the first one. The checks query
  // re-reads the same column but its answer can lag (cache) or never come
  // (it is permission-gated); the row is authoritative for never leading a
  // traced project with "send your first trace".
  const hasTraces =
    (project?.firstMessage ?? false) || (data?.firstMessage ?? false);

  return {
    isLoading: isLoading || !data,
    isNewProject: !isLoading && !!data && !hasTraces,
    hasTraces,
    hasEvaluations: (data?.onlineEvaluations ?? 0) > 0,
    hasExperiments: (data?.simulations ?? 0) > 0 || (data?.datasets ?? 0) > 0,
  };
}
