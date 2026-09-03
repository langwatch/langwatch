/**
 * The project column's entries: Home, Observe, Test and Build.
 *
 * Moved from `platform/app/src/components/MainMenu.tsx`. What travelled is the
 * SECTIONS — the list the product sidebar renders — and the two width
 * constants, which now live in `model/menu-widths` because the shell's own
 * layout math reads them.
 *
 * WHAT DID NOT TRAVEL, and why it is a deletion rather than a gap:
 *
 * - The `MainMenu` COLUMN itself, and the `OpsSection` inside it. Both belong
 *   to `DashboardLayout`, the legacy chrome this move deletes: the shell that
 *   renders these sections draws its own column, and offers every operations
 *   page from the settings menu instead (`opsGroup`). Moving a column nothing
 *   mounts would be the dead code this migration forbids.
 * - `projectRoutes`. `platform/app/src/utils/routes.ts` was deleted by commit
 *   `72ed591a13` while this move was in flight, which is what left this module
 *   importing something that no longer existed. The nineteen destinations the
 *   menu read off it are `model/project-nav-items`.
 * - `useRouter().pathname`. The host answers with the ADDRESS, and
 *   `toProjectRoutePattern` writes a project-anchored address back as the
 *   pattern, so every `isActive` test below keeps the exact comparison it was
 *   written with.
 *
 * Specs: specs/navigation/product-sidebars.feature,
 *        specs/navigation/ops-navigation-v2.feature
 */

import { GitPullRequest, SquareTerminal } from "lucide-react";
import React from "react";
import { navigationApi } from "../../behavior/navigation-api";
import { CODING_AGENT_LINK_WINDOW_DAYS, withinDays } from "../../model/coding-agent-activity";
import { featureIcons } from "../../model/feature-icons";
import {
  isExperimentsActivePath,
  isOnlineEvaluationsActivePath,
} from "../../model/navigation-active-state";
import { useNavigationHost, type NavigationProject } from "../../model/navigation-host";
import { projectNavItems, toProjectRoutePattern } from "../../model/project-nav-items";
import { projectScopedDestination } from "../../model/project-scoped-nav";
import { CollapsibleMenuGroup } from "../blocks/collapsible-menu-group";
import { SideMenuLink } from "../blocks/side-menu-link";
import { SidebarSection } from "../blocks/sidebar-section";

export { MENU_WIDTH_COMPACT, MENU_WIDTH_EXPANDED } from "../../model/menu-widths";

/**
 * The project navigation sections the LLM Ops sidebar renders. The Govern group
 * is gone because the product switcher replaces it, and the Ops group because
 * the settings menu holds the operations pages.
 */
export const MainMenuSections = function MainMenuSections({
  showExpanded,
}: {
  showExpanded: boolean;
}) {
  const host = useNavigationHost();
  const project = host.project();
  const pathname = toProjectRoutePattern({
    pathname: host.pathname(),
    projectSlug: project?.slug,
  });
  const pendingItemsCount = navigationApi.annotation.getPendingItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const codingAgentLinks = useCodingAgentLinks();

  const sectionProps = { showExpanded, project, pathname };

  return (
    <>
      <PageMenuLink
        path={projectNavItems.home.path}
        icon={featureIcons.home.icon}
        label={projectNavItems.home.title}
        project={project}
        isActive={pathname === "/[project]"}
        showLabel={showExpanded}
      />

      <ObserveSection {...sectionProps} codingAgentLinks={codingAgentLinks} />
      <TestSection {...sectionProps} pendingAnnotationCount={pendingItemsCount.data} />
      <BuildSection {...sectionProps} canSeeAutomations={host.hasPermission("triggers:view")} />
    </>
  );
};

interface ProjectSectionProps {
  showExpanded: boolean;
  project: NavigationProject | undefined;
  pathname: string;
}

interface CodingAgentLinks {
  shouldShowSessions: boolean;
  shouldShowPullRequests: boolean;
}

/**
 * Coding-agent destinations are grown by the project rather than configured.
 * Each one needs its own recent signal, so a project that records sessions but
 * has no pull request linked yet gets Sessions alone, and both go away again
 * once their signal falls out of the window.
 */
function useCodingAgentLinks(): CodingAgentLinks {
  const host = useNavigationHost();
  const project = host.project();
  const codingAgentPagesEnabled = host.featureFlag("release_ui_ai_governance_enabled").enabled;
  const canSeeCodingAgentActivity = codingAgentPagesEnabled && host.hasPermission("traces:view");
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
    <SidebarSection id="observe" label="Observe" showExpanded={showExpanded}>
      <PageMenuLink
        path={projectNavItems.analytics.path}
        icon={featureIcons.analytics.icon}
        label={projectNavItems.analytics.title}
        project={project}
        isActive={pathname.includes("/analytics")}
        showLabel={showExpanded}
      />
      <PageMenuLink
        path={projectNavItems.traces_v2.path}
        icon={featureIcons.traces_v2.icon}
        label={projectNavItems.traces_v2.title}
        project={project}
        isActive={pathname.includes("/traces")}
        showLabel={showExpanded}
      />
      <PageMenuLink
        path={projectNavItems.online_evaluations.path}
        icon={featureIcons.online_evaluations.icon}
        label="Online Evals"
        project={project}
        isActive={isOnlineEvaluationsActivePath(pathname)}
        showLabel={showExpanded}
      />
      {codingAgentLinks.shouldShowSessions && (
        <PageMenuLink
          path={projectNavItems.coding_agent_sessions.path}
          icon={SquareTerminal}
          label={projectNavItems.coding_agent_sessions.title}
          project={project}
          isActive={pathname === "/[project]/sessions"}
          showLabel={showExpanded}
        />
      )}
      {codingAgentLinks.shouldShowPullRequests && (
        <PageMenuLink
          path={projectNavItems.coding_agent_pull_requests.path}
          icon={GitPullRequest}
          label={projectNavItems.coding_agent_pull_requests.title}
          project={project}
          isActive={pathname === "/[project]/pull-requests"}
          showLabel={showExpanded}
        />
      )}
    </SidebarSection>
  );
}

function SimulationsMenuGroup({
  project,
  pathname,
  showExpanded,
}: {
  project: NavigationProject | undefined;
  pathname: string;
  showExpanded: boolean;
}) {
  return (
    <CollapsibleMenuGroup
      icon={featureIcons.simulations.icon}
      label={projectNavItems.simulations.title}
      showLabel={showExpanded}
      children={[
        {
          icon: featureIcons.scenarios.icon,
          label: projectNavItems.scenarios.title,
          ...projectScopedDestination({
            path: projectNavItems.scenarios.path,
            label: projectNavItems.scenarios.title,
            project,
          }),
          isActive: pathname.includes("/simulations/scenarios"),
        },
        {
          icon: featureIcons.simulation_runs.icon,
          label: projectNavItems.simulation_runs.title,
          ...projectScopedDestination({
            path: projectNavItems.simulation_runs.path,
            label: projectNavItems.simulation_runs.title,
            project,
          }),
          isActive:
            pathname.includes("/simulations") && !pathname.includes("/simulations/scenarios"),
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
  const host = useNavigationHost();
  const agentTestingEnabled = host.featureFlag("release_ui_agent_testing_v2_enabled").enabled;

  return (
    <SidebarSection id="test" label="Test" showExpanded={showExpanded}>
      {agentTestingEnabled ? (
        <PageMenuLink
          path={projectNavItems.agent_testing.path}
          icon={featureIcons.agent_testing.icon}
          label={projectNavItems.agent_testing.title}
          project={project}
          isActive={pathname.includes("/agent-testing")}
          showLabel={showExpanded}
        />
      ) : (
        <SimulationsMenuGroup project={project} pathname={pathname} showExpanded={showExpanded} />
      )}

      <PageMenuLink
        path={projectNavItems.experiments.path}
        icon={featureIcons.experiments.icon}
        label={projectNavItems.experiments.title}
        project={project}
        isActive={isExperimentsActivePath(pathname)}
        showLabel={showExpanded}
      />

      <PageMenuLink
        path={projectNavItems.annotations.path}
        icon={featureIcons.annotations.icon}
        label={projectNavItems.annotations.title}
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
    <SidebarSection id="library" label="Build" showExpanded={showExpanded} defaultExpanded={false}>
      <PageMenuLink
        path={projectNavItems.prompts.path}
        icon={featureIcons.prompts.icon}
        label={projectNavItems.prompts.title}
        project={project}
        isActive={pathname.includes("/prompts")}
        showLabel={showExpanded}
      />

      <PageMenuLink
        path={projectNavItems.agents.path}
        icon={featureIcons.agents.icon}
        label={projectNavItems.agents.title}
        project={project}
        isActive={pathname.includes("/agents")}
        showLabel={showExpanded}
      />

      <PageMenuLink
        path={projectNavItems.workflows.path}
        icon={featureIcons.workflows.icon}
        label={projectNavItems.workflows.title}
        project={project}
        isActive={pathname.includes("/workflows")}
        showLabel={showExpanded}
      />

      <PageMenuLink
        path={projectNavItems.evaluators.path}
        icon={featureIcons.evaluators.icon}
        label={projectNavItems.evaluators.title}
        project={project}
        isActive={pathname.includes("/evaluators")}
        showLabel={showExpanded}
      />

      <PageMenuLink
        path={projectNavItems.datasets.path}
        icon={featureIcons.datasets.icon}
        label={projectNavItems.datasets.title}
        project={project}
        isActive={pathname.includes("/datasets")}
        showLabel={showExpanded}
      />

      {canSeeAutomations && (
        <PageMenuLink
          path={projectNavItems.automations.path}
          icon={featureIcons.automations.icon}
          label={projectNavItems.automations.title}
          project={project}
          isActive={pathname.includes("/automations")}
          showLabel={showExpanded}
        />
      )}
    </SidebarSection>
  );
}

type PageMenuLinkProps = {
  icon: React.ComponentType<{ size?: string | number; color?: string }>;
  label: string;
  path: string;
  project?: NavigationProject;
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
