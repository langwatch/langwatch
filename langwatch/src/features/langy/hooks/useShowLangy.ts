import { OrganizationUserRole } from "@prisma/client";

import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { isLangwatchStaff, LANGY_RELEASE_FLAG } from "~/utils/isLangwatchStaff";

/**
 * Langy's visibility gate — "does this user have Langy?". Two layers:
 *
 * 1. Membership — user must belong to the team / be an org admin / be on a
 *    demo or own personal project. This is the relocated DashboardLayout
 *    gate; without it we'd render Langy for users who can't actually see
 *    the project.
 * 2. Rollout — staff bypass (LangWatch staff always have Langy). For
 *    everyone else, the `release_langy_enabled` flag must be on for this
 *    user. Defaults off in the registry, so non-staff are dark by default.
 *    This is UI hiding only; the authoritative check is the server-side
 *    `hasLangyAccess` gate on the Langy tRPC routers. Both share the
 *    `isLangwatchStaff` predicate and the `LANGY_RELEASE_FLAG` key so the
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

  const staff = isLangwatchStaff(user);
  // Skip the flag query entirely for staff (always allowed) and for non-members
  // (never allowed); the answer is decided without it. This keeps the menu
  // rendering on the first paint instead of waiting on a flag round-trip.
  const flagQueryEnabled = userIsPartOfTeam && !staff;
  const { enabled: releaseLangy } = useFeatureFlag(LANGY_RELEASE_FLAG, {
    projectId: project?.id,
    enabled: flagQueryEnabled,
  });

  return userIsPartOfTeam && (staff || releaseLangy);
}
