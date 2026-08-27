import { Box, VStack } from "@chakra-ui/react";
import {
  Activity,
  Anvil,
  DatabaseZap,
  Flag,
  GitPullRequest,
  History,
  Shield,
  SquareTerminal,
  Workflow,
} from "lucide-react";
import React, { useState } from "react";
import type { Project } from "~/generated/prisma/client";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";
import { useRouter } from "~/utils/compat/next-router";
import { useFeatureFlag } from "../hooks/useFeatureFlag";
import { useOpsPermission } from "../hooks/useOpsPermission";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { api } from "../utils/api";
import { featureIcons } from "../utils/featureIcons";
import { projectRoutes } from "../utils/routes";
import { CollapsibleMenuGroup } from "./sidebar/CollapsibleMenuGroup";
import {
  CODING_AGENT_LINK_WINDOW_DAYS,
  withinDays,
} from "./sidebar/codingAgentActivity";
import { GovernSection } from "./sidebar/GovernSection";
import {
  isExperimentsActivePath,
  isOnlineEvaluationsActivePath,
} from "./sidebar/navigationActiveState";
import { projectScopedDestination } from "./sidebar/projectScopedNav";
import { SidebarSection } from "./sidebar/SidebarSection";
import { SideMenuLink } from "./sidebar/SideMenuLink";
import { SupportMenu } from "./sidebar/SupportMenu";
import { ThemeToggle } from "./sidebar/ThemeToggle";
import { UsageIndicator } from "./sidebar/UsageIndicator";

export const MENU_WIDTH_EXPANDED = "200px";
export const MENU_WIDTH_COMPACT = "56px";
export const MENU_WIDTH = MENU_WIDTH_EXPANDED;

export type MainMenuProps = {
  isCompact?: boolean;
};

/**
 * The project navigation sections (Home, Observe, Test, Build, Govern,
 * Ops), extracted so the navigation-v2 LLM Ops sidebar renders the same
 * sections as the legacy chrome and the two cannot drift. The v2 sidebar
 * drops the Govern group because the product switcher replaces it, and
 * the Ops group because the settings menu holds the ops pages there.
 *
 * Specs: specs/navigation/product-sidebars.feature,
 *        specs/navigation/ops-navigation-v2.feature
 */
export const MainMenuSections = function MainMenuSections({
  showExpanded,
  shouldIncludeGovernSection = true,
  shouldIncludeOpsSection = true,
}: {
  showExpanded: boolean;
  shouldIncludeGovernSection?: boolean;
  shouldIncludeOpsSection?: boolean;
}) {
  const router = useRouter();
  const { project, hasPermission } = useOrganizationTeamProject();
  const pendingItemsCount = api.annotation.getPendingItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const codingAgentLinks = useCodingAgentLinks();

  const sectionProps = {
    showExpanded,
    project,
    pathname: router.pathname,
  };

  return (
    <>
      <PageMenuLink
        path={projectRoutes.home.path}
        icon={featureIcons.home.icon}
        label={projectRoutes.home.title}
        project={project}
        isActive={
          router.pathname === "/[project]" &&
          !router.pathname.includes("/analytics")
        }
        showLabel={showExpanded}
      />

      <ObserveSection {...sectionProps} codingAgentLinks={codingAgentLinks} />
      <TestSection
        {...sectionProps}
        pendingAnnotationCount={pendingItemsCount.data}
      />
      <BuildSection
        {...sectionProps}
        canSeeAutomations={hasPermission("triggers:view")}
      />

      {shouldIncludeGovernSection && (
        <GovernSection showExpanded={showExpanded} />
      )}

      {shouldIncludeOpsSection && <OpsSection showExpanded={showExpanded} />}
    </>
  );
};

interface ProjectSectionProps {
  showExpanded: boolean;
  project: ReturnType<typeof useOrganizationTeamProject>["project"];
  pathname: string;
}

interface CodingAgentLinks {
  shouldShowSessions: boolean;
  shouldShowPullRequests: boolean;
}

/**
 * Coding-agent destinations are grown by the project rather than
 * configured. Each one needs its own recent signal, so a project that
 * records sessions but has no pull request linked yet gets Sessions
 * alone, and both go away again once their signal falls out of the
 * window.
 */
function useCodingAgentLinks(): CodingAgentLinks {
  const { project, organization, hasPermission } = useOrganizationTeamProject();
  const { enabled: codingAgentPagesEnabled } = useFeatureFlag(
    "release_ui_ai_governance_enabled",
    {
      projectId: project?.id,
      organizationId: organization?.id,
      enabled: !!organization?.id,
    },
  );
  const canSeeCodingAgentActivity =
    codingAgentPagesEnabled && hasPermission("traces:view");
  const now = new Date();

  return {
    shouldShowSessions:
      canSeeCodingAgentActivity &&
      withinDays({
        at: project?.lastCodingAgentSessionAt,
        days: CODING_AGENT_LINK_WINDOW_DAYS,
        now,
      }),
    shouldShowPullRequests:
      canSeeCodingAgentActivity &&
      withinDays({
        at: project?.lastCodingAgentPullRequestAt,
        days: CODING_AGENT_LINK_WINDOW_DAYS,
        now,
      }),
  };
}

function ObserveSection({
  showExpanded,
  project,
  pathname,
  codingAgentLinks,
}: ProjectSectionProps & { codingAgentLinks: CodingAgentLinks }) {
  return (
    <SidebarSection
      id="observe"
      label="Observe"
      showExpanded={showExpanded}
      projectId={project?.id}
    >
      <PageMenuLink
        path={projectRoutes.analytics.path}
        icon={featureIcons.analytics.icon}
        label={projectRoutes.analytics.title}
        project={project}
        isActive={pathname.includes("/analytics")}
        showLabel={showExpanded}
      />
      <PageMenuLink
        path={projectRoutes.traces_v2.path}
        icon={featureIcons.traces_v2.icon}
        label={projectRoutes.traces_v2.title}
        project={project}
        isActive={pathname.includes("/traces")}
        showLabel={showExpanded}
      />
      <PageMenuLink
        path={projectRoutes.online_evaluations.path}
        icon={featureIcons.online_evaluations.icon}
        label="Online Evals"
        project={project}
        isActive={isOnlineEvaluationsActivePath(pathname)}
        showLabel={showExpanded}
      />
      {codingAgentLinks.shouldShowSessions && (
        <PageMenuLink
          path={projectRoutes.coding_agent_sessions.path}
          icon={SquareTerminal}
          label={projectRoutes.coding_agent_sessions.title}
          project={project}
          isActive={pathname === "/[project]/sessions"}
          showLabel={showExpanded}
        />
      )}
      {codingAgentLinks.shouldShowPullRequests && (
        <PageMenuLink
          path={projectRoutes.coding_agent_pull_requests.path}
          icon={GitPullRequest}
          label={projectRoutes.coding_agent_pull_requests.title}
          project={project}
          isActive={pathname === "/[project]/pull-requests"}
          showLabel={showExpanded}
        />
      )}
    </SidebarSection>
  );
}

function SimulationsFallbackGroup({
  showExpanded,
  project,
  pathname,
}: ProjectSectionProps) {
  return (
    <CollapsibleMenuGroup
      icon={featureIcons.simulations.icon}
      label={projectRoutes.simulations.title}
      project={project}
      showLabel={showExpanded}
      children={[
        {
          icon: featureIcons.scenarios.icon,
          label: projectRoutes.scenarios.title,
          ...projectScopedDestination({
            path: projectRoutes.scenarios.path,
            label: projectRoutes.scenarios.title,
            project,
          }),
          isActive: pathname.includes("/simulations/scenarios"),
        },
        {
          icon: featureIcons.simulation_runs.icon,
          label: projectRoutes.simulation_runs.title,
          ...projectScopedDestination({
            path: projectRoutes.simulation_runs.path,
            label: projectRoutes.simulation_runs.title,
            project,
          }),
          isActive:
            pathname.includes("/simulations") &&
            !pathname.includes("/simulations/scenarios"),
        },
      ]}
    />
  );
}

function TestSection({
  showExpanded,
  project,
  pathname,
  pendingAnnotationCount,
}: ProjectSectionProps & { pendingAnnotationCount: number | undefined }) {
  // One destination replaces the Simulations group, and the two cannot both
  // be offered: they address the same runs through different routes, so a menu
  // holding both would give a person two links to the same work.
  const { organization } = useOrganizationTeamProject();
  const { enabled: agentTestingEnabled, isLoading: flagReadLoading } =
    useFeatureFlag("release_ui_agent_testing_v2_enabled", {
      projectId: project?.id,
      organizationId: organization?.id,
      // Both ids come from the same workspace query, and a rule may name
      // either one, so the read waits until both are known.
      enabled: !!project?.id && !!organization?.id,
    });
  // The read stays idle until both ids arrive, so "not loading" alone does
  // not mean the answer is in. The menu shows neither destination until it is.
  const agentTestingFlagLoading =
    flagReadLoading || !project?.id || !organization?.id;

  return (
    <SidebarSection
      id="test"
      label="Test"
      showExpanded={showExpanded}
      projectId={project?.id}
    >
      {agentTestingFlagLoading ? null : agentTestingEnabled ? (
        <PageMenuLink
          path={projectRoutes.agent_testing.path}
          icon={featureIcons.agent_testing.icon}
          label={projectRoutes.agent_testing.title}
          project={project}
          isActive={pathname.includes("/agent-testing")}
          showLabel={showExpanded}
        />
      ) : (
        <SimulationsFallbackGroup
          showExpanded={showExpanded}
          project={project}
          pathname={pathname}
        />
      )}

      <PageMenuLink
        path={projectRoutes.experiments.path}
        icon={featureIcons.experiments.icon}
        label={projectRoutes.experiments.title}
        project={project}
        isActive={isExperimentsActivePath(pathname)}
        showLabel={showExpanded}
      />

      <PageMenuLink
        path={projectRoutes.annotations.path}
        icon={featureIcons.annotations.icon}
        label={projectRoutes.annotations.title}
        project={project}
        badgeNumber={pendingAnnotationCount}
        isActive={pathname.includes("/annotations")}
        showLabel={showExpanded}
      />
    </SidebarSection>
  );
}

function BuildSection({
  showExpanded,
  project,
  pathname,
  canSeeAutomations,
}: ProjectSectionProps & { canSeeAutomations: boolean }) {
  return (
    <SidebarSection
      id="library"
      label="Build"
      showExpanded={showExpanded}
      defaultExpanded={false}
      projectId={project?.id}
    >
      <PageMenuLink
        path={projectRoutes.prompts.path}
        icon={featureIcons.prompts.icon}
        label={projectRoutes.prompts.title}
        project={project}
        isActive={pathname.includes("/prompts")}
        showLabel={showExpanded}
      />

      <PageMenuLink
        path={projectRoutes.agents.path}
        icon={featureIcons.agents.icon}
        label={projectRoutes.agents.title}
        project={project}
        isActive={pathname.includes("/agents")}
        showLabel={showExpanded}
      />

      <PageMenuLink
        path={projectRoutes.workflows.path}
        icon={featureIcons.workflows.icon}
        label={projectRoutes.workflows.title}
        project={project}
        isActive={pathname.includes("/workflows")}
        showLabel={showExpanded}
      />

      <PageMenuLink
        path={projectRoutes.evaluators.path}
        icon={featureIcons.evaluators.icon}
        label={projectRoutes.evaluators.title}
        project={project}
        isActive={pathname.includes("/evaluators")}
        showLabel={showExpanded}
      />

      <PageMenuLink
        path={projectRoutes.datasets.path}
        icon={featureIcons.datasets.icon}
        label={projectRoutes.datasets.title}
        project={project}
        isActive={pathname.includes("/datasets")}
        showLabel={showExpanded}
      />

      {canSeeAutomations && (
        <PageMenuLink
          path={projectRoutes.automations.path}
          icon={featureIcons.automations.icon}
          label={projectRoutes.automations.title}
          project={project}
          isActive={pathname.includes("/automations")}
          showLabel={showExpanded}
        />
      )}
    </SidebarSection>
  );
}

export const MainMenu = React.memo(function MainMenu({
  isCompact = false,
}: MainMenuProps) {
  const router = useRouter();
  const { project, hasPermission, isPublicRoute } =
    useOrganizationTeamProject();
  const [isHovered, setIsHovered] = useState(false);

  // In compact mode, show expanded view on hover
  const showExpanded = !isCompact || isHovered;
  const currentWidth = showExpanded ? MENU_WIDTH_EXPANDED : MENU_WIDTH_COMPACT;

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
          <VStack
            width="full"
            gap={0.5}
            align="start"
            flex={1}
            minHeight={0}
            overflowY="auto"
            overflowX="hidden"
            css={{
              scrollbarWidth: "thin",
              "&::-webkit-scrollbar": { width: "4px" },
              "&::-webkit-scrollbar-thumb": {
                background: "var(--chakra-colors-border-emphasized)",
                borderRadius: "2px",
              },
              "&::-webkit-scrollbar-track": { background: "transparent" },
            }}
          >
            <MainMenuSections showExpanded={showExpanded} />
          </VStack>

          <VStack width="full" gap={0.5} align="start">
            <UsageIndicator showLabel={showExpanded} />
            {(!!hasPermission("organization:view") || isPublicRoute) && (
              <PageMenuLink
                path={projectRoutes.settings.path}
                icon={featureIcons.settings.icon}
                label={projectRoutes.settings.title}
                project={project}
                isActive={router.pathname.includes("/settings")}
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

const OpsSection = ({ showExpanded }: { showExpanded: boolean }) => {
  const router = useRouter();
  const { hasAccess } = useOpsPermission();
  const publicEnv = usePublicEnv();
  // Fleet-wide allowlist (env) OR a per-browser pin from the hidden Feature
  // Flags drawer. The pin is only queried for users who already have ops
  // access — it is a visibility convenience, never a way to widen access.
  //
  // Both knobs steer this sidebar only. The navigation-v2 settings menu lists
  // Ops on ops access alone, so `SHOW_OPS_IN_MAIN_SIDEBAR` and
  // `ops_ui_ops_menu_pinned` can be deleted with this section when the legacy
  // chrome retires.
  const envAlwaysShow = publicEnv.data?.SHOW_OPS_IN_MAIN_SIDEBAR ?? false;
  const { enabled: opsMenuPinned } = useFeatureFlag("ops_ui_ops_menu_pinned", {
    // A per-browser pin for an operator, decided by ops access alone. No
    // tenant takes part in it, so neither scope is targeted.
    projectId: NOT_TARGETED,
    organizationId: NOT_TARGETED,
    enabled: hasAccess,
  });
  const alwaysShow = envAlwaysShow || opsMenuPinned;
  const isOnOpsRoute = router.pathname.startsWith("/ops");
  const shouldShow = hasAccess && (alwaysShow || isOnOpsRoute);

  // Two-tier polling so the always-on global badge doesn't drag the full
  // dashboard aggregation into every tRPC batch. tRPC's `httpBatchLink`
  // bundles multiple queries that fire in the same ~10ms window into one
  // HTTP request and waits on every procedure before responding — so a
  // slow `getDashboardSnapshot` call running in the background here would
  // stall every page-level query batched alongside it. Off-route we ask
  // only for the two integers the badge renders; on-route we lift to the
  // full snapshot since the user actually wants the data.
  const opsBadge = api.ops.getBadgeCounts.useQuery(undefined, {
    enabled: shouldShow && !isOnOpsRoute,
    refetchInterval: 60000,
  });
  const opsData = api.ops.getDashboardSnapshot.useQuery(undefined, {
    enabled: shouldShow && isOnOpsRoute,
    refetchInterval: 10000,
  });

  // Backoffice is admin-only. `useOpsPermission` already gates the whole
  // OPS section on admin today, but we keep the isAdmin query decoupled so
  // that if ops:view ever broadens beyond admin, the Backoffice link still
  // stays strictly admin-only. Gated on `shouldShow` so the request is
  // skipped entirely when the section isn't rendered.
  const adminStatus = api.user.isAdmin.useQuery(
    {},
    { enabled: shouldShow, retry: false, refetchOnWindowFocus: false },
  );
  const isAdminUser = adminStatus.data?.isAdmin ?? false;

  if (!shouldShow) return null;

  // On-route: derive from the full snapshot the dashboard already loaded.
  // Off-route: read from the lightweight badge counts. Either way the
  // badge stays in sync.
  const blockedCount = isOnOpsRoute
    ? (opsData.data?.queues.reduce((sum, q) => sum + q.blockedGroupCount, 0) ??
      0)
    : (opsBadge.data?.blockedCount ?? 0);
  const dlqCount = isOnOpsRoute
    ? (opsData.data?.queues.reduce((sum, q) => sum + q.dlqCount, 0) ?? 0)
    : (opsBadge.data?.dlqCount ?? 0);

  return (
    <SidebarSection id="ops" label="Ops" showExpanded={showExpanded}>
      <SideMenuLink
        icon={Activity}
        label="Dashboard"
        href="/ops"
        isActive={
          router.pathname === "/ops" ||
          router.pathname.startsWith("/ops/queues")
        }
        badgeNumber={blockedCount + dlqCount}
        showLabel={showExpanded}
      />
      <SideMenuLink
        icon={Workflow}
        label="Event Sourcing"
        href="/ops/event-sourcing"
        isActive={
          router.pathname.startsWith("/ops/event-sourcing") ||
          router.pathname.startsWith("/ops/projections")
        }
        showLabel={showExpanded}
      />
      <SideMenuLink
        icon={Anvil}
        label="The Foundry"
        href="/ops/foundry"
        isActive={router.pathname.startsWith("/ops/foundry")}
        showLabel={showExpanded}
      />
      <SideMenuLink
        icon={History}
        label="Deja View"
        href="/ops/dejaview"
        isActive={router.pathname.startsWith("/ops/dejaview")}
        showLabel={showExpanded}
      />
      <SideMenuLink
        icon={Flag}
        label="Feature Flags"
        href="/ops/feature-flags"
        isActive={router.pathname.startsWith("/ops/feature-flags")}
        showLabel={showExpanded}
      />
      <SideMenuLink
        icon={DatabaseZap}
        label="Migrations"
        href="/ops/migrations"
        isActive={router.pathname.startsWith("/ops/migrations")}
        showLabel={showExpanded}
      />
      {isAdminUser && (
        <SideMenuLink
          icon={Shield}
          label="Backoffice"
          href="/ops/backoffice/users"
          isActive={router.pathname.startsWith("/ops/backoffice")}
          showLabel={showExpanded}
        />
      )}
    </SidebarSection>
  );
};

type PageMenuLinkProps = {
  icon: React.ComponentType<{ size?: string | number; color?: string }>;
  label: string;
  path: string;
  project?: Project;
  badgeNumber?: number;
  isActive: boolean;
  showLabel?: boolean;
  beta?: string | boolean;
  betaLabel?: string;
  legacy?: string | boolean;
  legacyLabel?: string;
};

const PageMenuLink = ({
  icon,
  label,
  path,
  project,
  badgeNumber,
  isActive,
  showLabel = true,
  beta,
  betaLabel,
  legacy,
  legacyLabel,
}: PageMenuLinkProps) => {
  const destination = projectScopedDestination({ path, label, project });

  return (
    <SideMenuLink
      icon={icon}
      label={label}
      href={destination.href}
      unavailableReason={destination.unavailableReason}
      isActive={isActive}
      badgeNumber={badgeNumber}
      showLabel={showLabel}
      beta={beta}
      betaLabel={betaLabel}
      legacy={legacy}
      legacyLabel={legacyLabel}
    />
  );
};
