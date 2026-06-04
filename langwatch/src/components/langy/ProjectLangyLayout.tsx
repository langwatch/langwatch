import { Box } from "@chakra-ui/react";
import { OrganizationUserRole } from "@prisma/client";
import type { ReactNode } from "react";
import { Outlet, useParams } from "react-router";

import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { isLangwatchStaff } from "~/utils/isLangwatchStaff";

import { LangyProvider, useLangy } from "./LangyContext";
import {
  LANGY_DOCKED_OFFSET,
  LANGY_TRANSITION,
  LangyDrawer,
} from "./LangySidebar";

/**
 * Layout route that mounts Langy once per project, above the swapping page.
 *
 * Mounting Langy here — rather than inside the per-page DashboardLayout — is
 * what lets the panel, the composer draft, and any in-flight response survive
 * navigation between pages of the same project: React Router keeps this layout
 * route mounted and only swaps the <Outlet/> beneath it.
 *
 * The provider is keyed by the :project URL segment, so Langy resets cleanly
 * when the user switches projects (its conversations and memory are
 * project-scoped). Visibility itself is unchanged from the previous
 * DashboardLayout gate — see useShowLangy.
 *
 * Spec: specs/assistant/langy-navigation-persistence.feature
 */
export default function ProjectLangyLayout() {
  const { project: projectSlug } = useParams();
  const showLangy = useShowLangy();

  return (
    <LangyProvider key={projectSlug}>
      <LangyShiftedRoot showLangy={showLangy}>
        <Outlet />
      </LangyShiftedRoot>
    </LangyProvider>
  );
}

/**
 * Langy's visibility gate, relocated verbatim from DashboardLayout. Langy is a
 * staff-only, flag-gated surface shown on project routes the user belongs to.
 * The original `!publicPage` and `isProjectRoute` terms are implied here — this
 * component only renders under /:project/* routes, which are never public — so
 * they drop out. Everything else is derivable from app-level hooks, which is
 * why Langy can live a level above the page.
 */
function useShowLangy(): boolean {
  const { data: session } = useRequiredSession();
  const { team, project, organization, organizationRole } =
    useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    });
  const publicEnv = usePublicEnv();
  const { enabled: langyFlagEnabled } = useFeatureFlag(
    "release_langy_enabled",
    {
      projectId: project?.id,
      organizationId: organization?.id,
      enabled: !!project,
    },
  );

  const user = session?.user;
  const isDemoProject = publicEnv.data?.DEMO_PROJECT_SLUG === project?.slug;
  const isOnOwnPersonalProject =
    !!team?.isPersonal && team.ownerUserId === user?.id;
  const userIsPartOfTeam =
    isOnOwnPersonalProject ||
    isDemoProject ||
    (team?.members?.some((member) => member.userId === user?.id) ?? false) ||
    organizationRole === OrganizationUserRole.ADMIN;

  return userIsPartOfTeam;
}

/**
 * Wraps the routed page in a box that reserves room on the right while the
 * docked panel is open (so content slides over instead of hiding under it),
 * and renders the panel itself as a sibling. The page-chrome box (background,
 * min-height) stays in DashboardLayout so non-project routes are unaffected.
 */
function LangyShiftedRoot({
  showLangy,
  children,
}: {
  showLangy: boolean;
  children: ReactNode;
}) {
  const { isOpen } = useLangy();
  const shifted = showLangy && isOpen;
  return (
    <>
      <Box
        width="full"
        paddingRight={shifted ? `${LANGY_DOCKED_OFFSET}px` : 0}
        transition={`padding-right ${LANGY_TRANSITION}`}
      >
        {children}
      </Box>
      {showLangy && <LangyDrawerConnected />}
    </>
  );
}

function LangyDrawerConnected() {
  const { isOpen, setIsOpen, proposalHandlers, experimentSlug } = useLangy();
  return (
    <LangyDrawer
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      proposalHandlers={proposalHandlers}
      experimentSlug={experimentSlug}
    />
  );
}
