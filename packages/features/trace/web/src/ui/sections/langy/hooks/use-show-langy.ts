import { OrganizationUserRole } from "../../../../model/prisma-types";

import { useFeatureFlag } from "../../use-feature-flag";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { usePublicEnv } from "../../use-public-env";
import { useRequiredSession } from "../../../../behavior/auth-session";
import { LANGY_RELEASE_FLAG } from "../../../../model/langy-release-flag";

/**
 * Langy's visibility gate — "does this user have Langy?". Three layers:
 */
export interface LangyVisibility {
  /** Does this user have Langy? */
  show: boolean;
  /**
   * We do not KNOW yet — the session, the project, or the rollout flag is still in
   * flight.
   */
  isResolving: boolean;
}

/** The gate, with its own uncertainty exposed. See {@link LangyVisibility}. */
export function useLangyVisibility(): LangyVisibility {
  const { data: session, status: sessionStatus } = useRequiredSession();
  const {
    team,
    project,
    organization,
    organizationRole,
    hasPermission,
    isLoading: contextLoading,
  } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const publicEnv = usePublicEnv();

  const user = session?.user;
  // The server refuses Langy on the demo project outright, so rendering the panel there
  // would only produce a chat where every send 403s.
  const isDemoProject =
    !!publicEnv.data?.DEMO_PROJECT_SLUG && publicEnv.data.DEMO_PROJECT_SLUG === project?.slug;
  const isOnOwnPersonalProject = !!team?.isPersonal && team.ownerUserId === user?.id;
  const userIsPartOfTeam =
    isOnOwnPersonalProject ||
    (team?.members?.some((member) => member.userId === user?.id) ?? false) ||
    organizationRole === OrganizationUserRole.ADMIN;
  const mayReadLangy = userIsPartOfTeam && !isDemoProject && hasPermission("langy:view");

  // Skip the flag query entirely for callers who are already excluded; the answer is
  // decided without a round-trip.
  const { enabled: releaseLangy, isLoading: flagLoading } = useFeatureFlag(LANGY_RELEASE_FLAG, {
    projectId: project?.id,
    organizationId: organization?.id,
    enabled: mayReadLangy,
  });

  // Deliberately never waits on something that may never arrive: a reader with
  // no project at all is DECIDED (they cannot have Langy), not pending. Only
  // the three things that are genuinely in flight count.
  const isResolving =
    sessionStatus === "loading" || contextLoading || (mayReadLangy && flagLoading);

  return { show: mayReadLangy && releaseLangy, isResolving };
}

/**
 * The gate as a plain boolean, for the many callers that only hide a control.
 * Reports `false` while the answer is still loading — see {@link LangyVisibility}.
 */
export function useShowLangy(): boolean {
  return useLangyVisibility().show;
}
