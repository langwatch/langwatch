import { OrganizationUserRole } from "@prisma/client";

import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { LANGY_RELEASE_FLAG } from "~/utils/langyReleaseFlag";

/**
 * Langy's visibility gate — "does this user have Langy?". Three layers:
 *
 * 1. Membership — user must belong to the team / be an org admin / be on
 *    their own personal project. This is the relocated DashboardLayout gate;
 *    without it we'd render Langy for users who can't actually see the
 *    project. The demo project is excluded outright, because the server
 *    refuses Langy there and the panel would only 403 on every send.
 * 2. Permission — `langy:view`. The panel is a read surface, so it needs the
 *    same permission the read procedures demand; without this a custom role
 *    lacking `langy:view` would render a panel whose every call 401s. Starting
 *    a turn additionally needs `langy:create`, which the composer surfaces
 *    rather than this hook.
 * 3. Rollout — the `release_langy_enabled` flag must be on for this user.
 *    Defaults off in the registry, so everyone is dark until explicitly
 *    opted in; there is no identity-based bypass. The flag is resolved with
 *    the same project *and* organization context the server gate uses, so a
 *    rollout targeted at the whole org reveals the panel too — not only a
 *    per-project rule. This is UI hiding only; the authoritative check is the
 *    server-side `hasLangyAccess` gate on the Langy tRPC routers. Both read the
 *    same `LANGY_RELEASE_FLAG` key with the same context, so the panel can't
 *    render against procedures that would 404 — nor stay hidden while those
 *    procedures would happily answer.
 *
 * Consumed by ProjectLangyLayout (mounts the panel) and HomePageBanners
 * (picks the Langy activation banner over the promo teaser) — one gate,
 * so the banner can never invite a user into a panel that won't render.
 */
export interface LangyVisibility {
  /** Does this user have Langy? */
  show: boolean;
  /**
   * We do not KNOW yet — the session, the project, or the rollout flag is
   * still in flight.
   *
   * "No" and "not yet" are different answers, and every gate here collapses
   * them into `false` for callers that only need to hide a control (hiding it
   * for one extra frame costs nothing). A caller choosing between whole PAGE
   * COMPOSITIONS cannot afford that: answering "no" while the flag is in the
   * air renders the wrong home and then swaps it out underneath the reader.
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
  // The server refuses Langy on the demo project outright, so rendering the
  // panel there would only produce a chat where every send 403s.
  const isDemoProject = publicEnv.data?.DEMO_PROJECT_SLUG === project?.slug;
  const isOnOwnPersonalProject =
    !!team?.isPersonal && team.ownerUserId === user?.id;
  const userIsPartOfTeam =
    isOnOwnPersonalProject ||
    (team?.members?.some((member) => member.userId === user?.id) ?? false) ||
    organizationRole === OrganizationUserRole.ADMIN;
  const mayReadLangy =
    userIsPartOfTeam && !isDemoProject && hasPermission("langy:view");

  // Skip the flag query entirely for callers who are already excluded; the
  // answer is decided without a round-trip. Forward BOTH project and org ids,
  // exactly like the server-side `hasLangyAccess` gate: a targeting rule scoped
  // to an organization only matches when organizationId is in the evaluation
  // context, so omitting it would hide the panel for an org that has actually
  // been rolled out.
  const { enabled: releaseLangy, isLoading: flagLoading } = useFeatureFlag(
    LANGY_RELEASE_FLAG,
    {
      projectId: project?.id,
      organizationId: organization?.id,
      enabled: mayReadLangy,
    },
  );

  // Deliberately never waits on something that may never arrive: a reader with
  // no project at all is DECIDED (they cannot have Langy), not pending. Only
  // the three things that are genuinely in flight count.
  const isResolving =
    sessionStatus === "loading" ||
    contextLoading ||
    (mayReadLangy && flagLoading);

  return { show: mayReadLangy && releaseLangy, isResolving };
}

/**
 * The gate as a plain boolean, for the many callers that only hide a control.
 * Reports `false` while the answer is still loading — see {@link LangyVisibility}.
 */
export function useShowLangy(): boolean {
  return useLangyVisibility().show;
}
