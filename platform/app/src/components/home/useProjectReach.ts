import type { ProjectReach } from "~/features/langy/logic/langyHomeSuggestions";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { GuidedOnboardingCheck } from "~/server/onboarding-checks/onboarding-checks.service";
import { api } from "~/utils/api";

export interface ProjectReachResult extends ProjectReach {
  /** True until we know, so nothing offers asks it may have to withdraw. */
  isLoading: boolean;
  /** No traces yet: the home page leads with setup rather than figures. */
  isNewProject: boolean;
  /** Where the organization's guided onboarding stands; null until loaded. */
  guidedOnboarding: GuidedOnboardingCheck | null;
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
/** What the checks query answers, as far as reach is concerned. */
type ChecksAnswer =
  | {
      firstMessage?: boolean;
      guidedOnboarding?: GuidedOnboardingCheck;
      onlineEvaluations?: number;
      simulations?: number;
      datasets?: number;
    }
  | undefined;

/**
 * Whether a trace has ever arrived.
 *
 * The project row in hand already answers this: the collector flips
 * `firstMessage` on the first one. The checks query re-reads the same column
 * but its answer can lag (cache) or never come (it is permission-gated), so
 * the row is authoritative and a traced project is never led with "send your
 * first trace".
 */
function hasTracesFrom({
  projectFirstMessage,
  checks,
}: {
  projectFirstMessage: boolean | undefined;
  checks: ChecksAnswer;
}): boolean {
  return (projectFirstMessage ?? false) || (checks?.firstMessage ?? false);
}

/** The reach counts, read as the yes/no questions the home page asks. */
function reachFrom(checks: ChecksAnswer): Omit<ProjectReach, "hasTraces"> {
  return {
    hasEvaluations: (checks?.onlineEvaluations ?? 0) > 0,
    hasExperiments:
      (checks?.simulations ?? 0) > 0 || (checks?.datasets ?? 0) > 0,
  };
}

export function useProjectReach(): ProjectReachResult {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const { data, isLoading } = api.integrationsChecks.getCheckStatus.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const answered = !isLoading && !!data;
  const hasTraces = hasTracesFrom({
    projectFirstMessage: project?.firstMessage,
    checks: data,
  });

  return {
    ...reachFrom(data),
    isLoading: isLoading || !data,
    isNewProject: answered && !hasTraces,
    guidedOnboarding: data?.guidedOnboarding ?? null,
    hasTraces,
  };
}
