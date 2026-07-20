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
  const { team, project, organizationRole, hasPermission } =
    useOrganizationTeamProject({
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
  // answer is decided without a round-trip.
  const { enabled: releaseLangy } = useFeatureFlag(LANGY_RELEASE_FLAG, {
    projectId: project?.id,
    enabled: mayReadLangy,
  });

  return mayReadLangy && releaseLangy;
}
