import { Box, VStack } from "@chakra-ui/react";
import {
  Bot,
  ClipboardList,
  Database,
  Gauge,
  GitPullRequest,
  ListTree,
  Settings as SettingsIcon,
  Sliders,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { findPersonalProject } from "~/utils/personalProject";

import { MENU_WIDTH_COMPACT, MENU_WIDTH_EXPANDED } from "./MainMenu";
import { GovernSection } from "./sidebar/GovernSection";
import { isOnlineEvaluationsActivePath } from "./sidebar/navigationActiveState";
import { SideMenuLink } from "./sidebar/SideMenuLink";
import { SupportMenu } from "./sidebar/SupportMenu";
import { ThemeToggle } from "./sidebar/ThemeToggle";

/**
 * Personal-scope sidebar rendered by DashboardLayout when
 * `personalScope=true`. Mirrors MainMenu's column shape (compact-on-hover,
 * width math, top-aligned primary nav + bottom-aligned utilities) so the
 * page geometry stays identical between project and personal scopes.
 *
 * Spec: specs/ai-gateway/governance/persona-aware-chrome.feature
 *       — Persona 1 / Persona 2 (personal scope)
 */
/**
 * The personal navigation links, extracted so the navigation-v2 Me
 * sidebar renders the same list as the legacy chrome and the two cannot
 * drift. The v2 sidebar drops the Govern group because the product
 * switcher replaces it.
 *
 * Spec: specs/navigation/product-sidebars.feature
 */
export const PersonalSidebarLinks = function PersonalSidebarLinks({
  showExpanded,
  shouldIncludeGovernSection = true,
}: {
  showExpanded: boolean;
  shouldIncludeGovernSection?: boolean;
}) {
  const router = useRouter();
  const { personalProjectSlug, features } = usePersonalWorkspace();
  const tracesHref = personalProjectSlug ? `/${personalProjectSlug}/traces` : null;

  return (
    <>
      <SideMenuLink
        icon={Gauge}
        label="My Usage"
        href="/me"
        isActive={router.pathname === "/me"}
        showLabel={showExpanded}
      />
      {tracesHref && (
        <SideMenuLink
          icon={ListTree}
          label="Traces"
          href={tracesHref}
          isActive={router.pathname.includes("/traces")}
          showLabel={showExpanded}
        />
      )}
      <SideMenuLink
        icon={SquareTerminal}
        label="Sessions"
        href="/me/sessions"
        isActive={router.pathname.startsWith("/me/sessions")}
        showLabel={showExpanded}
      />
      <SideMenuLink
        icon={GitPullRequest}
        label="Pull Requests"
        href="/me/pull-requests"
        isActive={router.pathname.startsWith("/me/pull-requests")}
        showLabel={showExpanded}
      />
      <PersonalLibraryLinks
        showExpanded={showExpanded}
        pathname={router.pathname}
        personalProjectSlug={personalProjectSlug}
        features={features}
      />
      <SideMenuLink
        icon={Sliders}
        label="Configure"
        href="/me/configure"
        isActive={router.pathname.startsWith("/me/configure")}
        showLabel={showExpanded}
      />
      {shouldIncludeGovernSection && <GovernSection showExpanded={showExpanded} />}
    </>
  );
};

/**
 * Personal-workspace advanced features unlock the library nav entries
 * (datasets, evaluations, annotations, automations). Default-empty storage
 * means existing users see Traces only; the bundle checkbox in
 * /me/configure flips them on with one atomic write and an audit entry.
 */
interface PersonalWorkspaceFeatures {
  evaluations?: boolean;
  datasets?: boolean;
  annotations?: boolean;
  automations?: boolean;
}

function usePersonalWorkspace(): {
  personalProjectSlug: string | null;
  features: PersonalWorkspaceFeatures | undefined;
} {
  const session = useRequiredSession();
  const { organizations } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const personalProject = useMemo(
    () =>
      findPersonalProject({
        organizations,
        userId: session.data?.user?.id,
      }),
    [organizations, session.data?.user?.id],
  );
  const personalProjectId = personalProject?.id ?? null;
  const featuresQuery = api.personalWorkspaceFeatures.get.useQuery(
    { projectId: personalProjectId ?? "" },
    { enabled: !!personalProjectId, refetchOnWindowFocus: false },
  );

  return {
    personalProjectSlug: personalProject?.slug ?? null,
    features: featuresQuery.data,
  };
}

/**
 * The library entries link to the personal project's own
 * `/[project]/<section>` routes, so they highlight off the current path
 * the same way MainMenu does for project nav.
 */
function PersonalLibraryLinks({
  showExpanded,
  pathname,
  personalProjectSlug,
  features,
}: {
  showExpanded: boolean;
  pathname: string;
  personalProjectSlug: string | null;
  features: PersonalWorkspaceFeatures | undefined;
}) {
  if (!personalProjectSlug) return null;

  return (
    <>
      {features?.evaluations && (
        <SideMenuLink
          icon={ClipboardList}
          label="Online Evals"
          href={`/${personalProjectSlug}/online-evaluations`}
          isActive={isOnlineEvaluationsActivePath(pathname)}
          showLabel={showExpanded}
        />
      )}
      {features?.datasets && (
        <SideMenuLink
          icon={Database}
          label="Datasets"
          href={`/${personalProjectSlug}/datasets`}
          isActive={pathname.includes("/datasets")}
          showLabel={showExpanded}
        />
      )}
      {features?.annotations && (
        <SideMenuLink
          icon={Sparkles}
          label="Annotations"
          href={`/${personalProjectSlug}/annotations`}
          isActive={pathname.includes("/annotations")}
          showLabel={showExpanded}
        />
      )}
      {features?.automations && (
        <SideMenuLink
          icon={Bot}
          label="Automations"
          href={`/${personalProjectSlug}/automations`}
          isActive={pathname.includes("/automations")}
          showLabel={showExpanded}
        />
      )}
    </>
  );
}

export const PersonalSidebar = React.memo(function PersonalSidebar({
  isCompact = false,
}: {
  isCompact?: boolean;
}) {
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);

  const showExpanded = !isCompact || isHovered;
  const currentWidth = showExpanded ? MENU_WIDTH_EXPANDED : MENU_WIDTH_COMPACT;

  const isOrgSettingsActive = router.pathname.startsWith("/settings");
  const { hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  return (
    <Box
      background="bg.page"
      width={isCompact ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED}
      minWidth={isCompact ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED}
      height="calc(100vh - 60px)"
      position="relative"
      onMouseEnter={() => isCompact && setIsHovered(true)}
      onMouseLeave={() => isCompact && setIsHovered(false)}
    >
      <Box
        position={isCompact ? "absolute" : "relative"}
        zIndex={isCompact ? 100 : "auto"}
        top={0}
        left={0}
        width={currentWidth}
        height="calc(100vh - 60px)"
        background="bg.page"
        transition="width 0.15s ease-in-out"
        overflow="hidden"
      >
        <VStack
          paddingX={2}
          paddingTop={2}
          paddingBottom={2}
          gap={0}
          height="100%"
          align="start"
          width={MENU_WIDTH_EXPANDED}
          justifyContent="space-between"
        >
          <VStack width="full" gap={0.5} align="start">
            <PersonalSidebarLinks showExpanded={showExpanded} />
          </VStack>

          <VStack width="full" gap={0.5} align="start">
            {hasPermission("organization:view") && (
              <SideMenuLink
                icon={SettingsIcon}
                label="Settings"
                href="/settings"
                isActive={isOrgSettingsActive}
                showLabel={showExpanded}
              />
            )}
            <SupportMenu showLabel={showExpanded} />
            <ThemeToggle showLabel={showExpanded} />
          </VStack>
        </VStack>
      </Box>
    </Box>
  );
});
