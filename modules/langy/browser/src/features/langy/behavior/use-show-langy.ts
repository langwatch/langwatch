/**
 * Langy's visibility gate — "does this user have Langy?". Three layers:
 */

import { useRequiredSession } from "../../../behavior/auth-session.ts";
import { useFeatureFlag } from "../../../behavior/use-feature-flag.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";

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
  const { status: sessionStatus } = useRequiredSession();
  const {
    isDemoProject,
    hasPermission,
    isLoading: contextLoading,
  } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  // Team membership is not re-checked here: the scope carries no members, and a
  // reader outside the team holds no `langy:view` on its project anyway. The
  // server refuses the demo project outright, so the panel would only 403 there.
  const mayReadLangy = !isDemoProject && hasPermission("langy:view");

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
