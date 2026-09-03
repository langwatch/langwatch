/**
 * Langy's visibility gate — "does this user have Langy?". Three layers:
 *
 * 1. Membership — the reader must belong to the team, be an organization
 *    administrator, or be on their own personal project. Without it the panel
 *    renders for someone who cannot actually see the project.
 * 2. Permission — `langy:view`. The panel is a read surface, so it needs the
 *    same permission the read procedures demand; without this a custom role
 *    lacking `langy:view` would render a panel whose every call 401s. Starting
 *    a turn additionally needs `langy:create`, which the composer surfaces
 *    rather than this hook.
 * 3. Rollout — `release_langy_enabled` must be on for this reader. Defaults off
 *    in the registry, so everyone is dark until explicitly opted in. This is UI
 *    hiding only; the authoritative check is the server-side `hasLangyAccess`
 *    gate on the Langy tRPC routers. Both read the same flag key, so the panel
 *    cannot render against procedures that would 404 — nor stay hidden while
 *    those procedures would happily answer.
 *
 * WRITTEN HERE RATHER THAN MOVED, and that is worth naming: the gate lived in
 * `platform/app/src/features/langy/hooks`, and the TRACE family took a copy of
 * it into `@langwatch/trace-web` for the explorer's "ask Langy" control before
 * this family moved. That copy is bound to the trace host, which is not mounted
 * above the Langy layout, so it cannot be reused; the two must be kept in step
 * until whichever surface outlives the other takes the single one.
 *
 * ONE THING THE PLATFORM GATE HAD THAT STILL DIFFERS HERE: the
 * organization-scoped flag context, which the host's flag reader resolves for
 * the whole session rather than per target. The demo-project exclusion below
 * closes the other gap — `isDemoProject` is the application's own answer
 * (ADR-101: a deployment fact this package may not read itself), reached
 * through the host the same way membership and the flag are.
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
   * We do not KNOW yet — the session, the project, or the rollout flag is
   * still in flight.
   *
   * "No" and "not yet" are different answers, and every gate here collapses
   * them into `false` for callers that only need to hide a control. A caller
   * choosing between whole page compositions cannot afford that.
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
