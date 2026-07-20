import { OrganizationUserRole } from "@prisma/client";

import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { LANGY_RELEASE_FLAG } from "~/utils/langyReleaseFlag";

/**
 * Langy's visibility gate — "does this user have Langy?". Two layers:
 *
 * 1. Membership — user must belong to the team / be an org admin / be on a
 *    demo or own personal project. This is the relocated DashboardLayout
 *    gate; without it we'd render Langy for users who can't actually see
 *    the project.
 * 2. Rollout — the `release_langy_enabled` flag must be on for this user.
 *    Defaults off in the registry, so everyone is dark until explicitly
 *    opted in; there is no identity-based bypass. This is UI hiding only;
 *    the authoritative check is the server-side `hasLangyAccess` gate on the
 *    Langy tRPC routers. Both read the same `LANGY_RELEASE_FLAG` key so the
 *    panel can't render against procedures that would 404 anyway.
 *
 * Consumed by ProjectLangyLayout (mounts the panel) and HomePageBanners
 * (picks the Langy activation banner over the promo teaser) — one gate,
 * so the banner can never invite a user into a panel that won't render.
 */
export function useShowLangy(): boolean {
  const { data: session } = useRequiredSession();
  const { team, project, organizationRole } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const publicEnv = usePublicEnv();

  const user = session?.user;
  const isDemoProject = publicEnv.data?.DEMO_PROJECT_SLUG === project?.slug;
  const isOnOwnPersonalProject =
    !!team?.isPersonal && team.ownerUserId === user?.id;
  const userIsPartOfTeam =
    isOnOwnPersonalProject ||
    isDemoProject ||
    (team?.members?.some((member) => member.userId === user?.id) ?? false) ||
    organizationRole === OrganizationUserRole.ADMIN;

  // Skip the flag query entirely for non-members; they are never allowed, so
  // the answer is decided without a round-trip.
  const { enabled: releaseLangy } = useFeatureFlag(LANGY_RELEASE_FLAG, {
    projectId: project?.id,
    enabled: userIsPartOfTeam,
  });

  return userIsPartOfTeam && releaseLangy;
}
