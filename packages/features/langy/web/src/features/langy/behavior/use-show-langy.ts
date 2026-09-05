/**
 * Langy's visibility gate — "does this user have Langy?". Three layers:
 */

import { useFeatureFlag } from "../../../behavior/use-feature-flag";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { useRequiredSession } from "../../../behavior/auth-session";

/** The flag the server gate reads under the same name. */
export const LANGY_RELEASE_FLAG = "release_langy_enabled";

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
    organizationRole,
    isDemoProject,
    hasPermission,
    isLoading: contextLoading,
  } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const user = session?.user;
  const isOnOwnPersonalProject = !!team?.isPersonal && team.ownerUserId === user?.id;
  const userIsPartOfTeam =
    isOnOwnPersonalProject ||
    (team?.members?.some((member) => member.userId === user?.id) ?? false) ||
    organizationRole === "ADMIN";
  // The server refuses Langy on the demo project outright; rendering the
  // panel there would only produce a chat where every send 403s.
  const mayReadLangy = userIsPartOfTeam && !isDemoProject && hasPermission("langy:view");

  const { data: releaseLangy, isLoading: flagLoading } = useFeatureFlag(LANGY_RELEASE_FLAG);

  // Deliberately never waits on something that may never arrive: a reader with
  // no project at all is DECIDED (they cannot have Langy), not pending.
  const isResolving =
    sessionStatus === "loading" || contextLoading || (mayReadLangy && flagLoading);

  return { show: mayReadLangy && releaseLangy === true, isResolving };
}

/**
 * The gate as a plain boolean, for the many callers that only hide a control.
 * Reports `false` while the answer is still loading — see {@link LangyVisibility}.
 */
export function useShowLangy(): boolean {
  return useLangyVisibility().show;
}
