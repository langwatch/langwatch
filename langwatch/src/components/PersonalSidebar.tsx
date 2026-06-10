import { Box, VStack } from "@chakra-ui/react";
import {
  Bot,
  ClipboardList,
  Database,
  Gauge,
  ListTree,
  Settings as SettingsIcon,
  Sliders,
  Smartphone,
  Sparkles,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { useRouter } from "~/utils/compat/next-router";

import { useRequiredSession } from "~/hooks/useRequiredSession";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import { MENU_WIDTH_COMPACT, MENU_WIDTH_EXPANDED } from "./MainMenu";
import { GovernSection } from "./sidebar/GovernSection";
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
export const PersonalSidebar = React.memo(function PersonalSidebar({
  isCompact = false,
}: {
  isCompact?: boolean;
}) {
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);

  const showExpanded = !isCompact || isHovered;
  const currentWidth = showExpanded ? MENU_WIDTH_EXPANDED : MENU_WIDTH_COMPACT;

  const isUsageActive = router.pathname === "/me";
  const isConfigureActive = router.pathname.startsWith("/me/configure");
  const isSessionsActive = router.pathname.startsWith("/me/sessions");
  const isOrgSettingsActive =
    router.pathname === "/settings" ||
    (router.pathname.startsWith("/settings") &&
      !router.pathname.startsWith("/settings/gateway"));

  const session = useRequiredSession();
  const { organizations, hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const personalProject = useMemo(() => {
    const userId = session.data?.user?.id;
    if (!userId || !organizations) return null;
    for (const org of organizations) {
      for (const team of org.teams ?? []) {
        if (team.isPersonal && team.ownerUserId === userId) {
          const project = team.projects?.[0];
          if (project) return { id: project.id, slug: project.slug };
        }
      }
    }
    return null;
  }, [organizations, session.data?.user?.id]);
  const personalProjectSlug = personalProject?.slug ?? null;
  const personalProjectId = personalProject?.id ?? null;
  const tracesHref = personalProjectSlug
    ? `/${personalProjectSlug}/traces`
    : null;

  // The personal library entries link to the personal project's own
  // `/[project]/<section>` routes, so highlight them off the current path
  // the same way MainMenu does for project nav.
  const isTracesActive = router.pathname.includes("/traces");
  const isEvaluationsActive = router.pathname.includes("/evaluations");
  const isDatasetsActive = router.pathname.includes("/datasets");
  const isAnnotationsActive = router.pathname.includes("/annotations");
  const isAutomationsActive = router.pathname.includes("/automations");

  // Personal-workspace advanced features unlock the library nav entries
  // (datasets, evaluations, annotations, automations). Default-empty
  // storage means existing users see Traces only; clicking the bundle
  // checkbox in /me/configure flips them on with one atomic flip + audit.
  const featuresQuery = api.personalWorkspaceFeatures.get.useQuery(
    { projectId: personalProjectId ?? "" },
    { enabled: !!personalProjectId, refetchOnWindowFocus: false },
  );
  const features = featuresQuery.data;

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
            <SideMenuLink
              icon={Gauge}
              label="My Usage"
              href="/me"
              isActive={isUsageActive}
              showLabel={showExpanded}
            />
            {tracesHref && (
              <SideMenuLink
                icon={ListTree}
                label="Traces"
                href={tracesHref}
                isActive={isTracesActive}
                showLabel={showExpanded}
              />
            )}
            {personalProjectSlug && features?.evaluations && (
              <SideMenuLink
                icon={ClipboardList}
                label="Evaluations"
                href={`/${personalProjectSlug}/evaluations`}
                isActive={isEvaluationsActive}
                showLabel={showExpanded}
              />
            )}
            {personalProjectSlug && features?.datasets && (
              <SideMenuLink
                icon={Database}
                label="Datasets"
                href={`/${personalProjectSlug}/datasets`}
                isActive={isDatasetsActive}
                showLabel={showExpanded}
              />
            )}
            {personalProjectSlug && features?.annotations && (
              <SideMenuLink
                icon={Sparkles}
                label="Annotations"
                href={`/${personalProjectSlug}/annotations`}
                isActive={isAnnotationsActive}
                showLabel={showExpanded}
              />
            )}
            {personalProjectSlug && features?.automations && (
              <SideMenuLink
                icon={Bot}
                label="Automations"
                href={`/${personalProjectSlug}/automations`}
                isActive={isAutomationsActive}
                showLabel={showExpanded}
              />
            )}
            <SideMenuLink
              icon={Smartphone}
              label="Sessions"
              href="/me/sessions"
              isActive={isSessionsActive}
              showLabel={showExpanded}
            />
            <SideMenuLink
              icon={Sliders}
              label="Configure"
              href="/me/configure"
              isActive={isConfigureActive}
              showLabel={showExpanded}
            />
            <GovernSection showExpanded={showExpanded} />
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
