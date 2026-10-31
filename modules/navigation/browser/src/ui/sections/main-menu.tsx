/**
 * Project menu sections (Home, Observe, Test, Build). Moved from platform/app;
 * doesn't include MainMenu column (deleted with DashboardLayout).
 */

import { FrontendFlags } from "@langwatch/feature-flag-contract";
import type { NavigationProject } from "@langwatch/navigation-contract";
import { projectNavigation } from "@langwatch/project-contract";
import { GitPullRequest, SquareTerminal } from "lucide-react";
import React from "react";

import { navigationApi } from "../../behavior/navigation-api.ts";
import { useAnalyticsEntry } from "../../behavior/use-analytics-entry.ts";
import {
  type CodingAgentLinks,
  useCodingAgentLinks,
} from "../../behavior/use-coding-agent-links.ts";
import { featureIcons } from "../../model/feature-icons.ts";
import {
  isExperimentsActivePath,
  isOnlineEvaluationsActivePath,
} from "../../model/navigation-active-state.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import { projectNavItems, toProjectRoutePattern } from "../../model/project-nav-items.ts";
import { projectScopedDestination } from "../../model/project-scoped-nav.ts";
import { CollapsibleMenuGroup } from "../blocks/collapsible-menu-group.tsx";
import { SideMenuLink } from "../blocks/side-menu-link.tsx";
import { SidebarSection } from "./sidebar-section.tsx";

/**
 * The project navigation sections the LLM Ops sidebar renders. The Govern group
 * is gone because the product switcher replaces it, and the Ops group because
 * the settings menu holds the operations pages. Dashboards is its own product.
 */
export const MainMenuSections = function MainMenuSections({
  showExpanded,
}: {
  showExpanded: boolean;
}) {
  const host = useNavigationHost();
  const project = host.project();
  const navigation = projectNavigation(project?.kind);
  const pathname = toProjectRoutePattern({
    pathname: host.pathname(),
    projectSlug: project?.slug,
  });
  const pendingItemsCount = navigationApi.annotation.getPendingItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && navigation.test },
  );
  const codingAgentLinks = useCodingAgentLinks();
  const analyticsEntry = useAnalyticsEntry();

  const sectionProps = { showExpanded, project, pathname };

  return (
    <>
      {navigation.home && (
        <PageMenuLink
          path={projectNavItems.home.path}
          icon={featureIcons.home.icon}
          label={projectNavItems.home.title}
          project={project}
          isActive={pathname === "/[project]"}
          showLabel={showExpanded}
        />
      )}

      <ObserveSection
        {...sectionProps}
        codingAgentLinks={codingAgentLinks}
        showAnalytics={navigation.analytics}
        analyticsEntry={analyticsEntry}
        showOnlineEvaluations={navigation.onlineEvaluations}
      />
      {navigation.test && (
        <TestSection {...sectionProps} pendingAnnotationCount={pendingItemsCount.data?.count} />
      )}
      {navigation.build && (
        <BuildSection {...sectionProps} canSeeAutomations={host.hasPermission("triggers:view")} />
      )}
    </>
  );
};

interface ProjectSectionProps {
  showExpanded: boolean;
  project: NavigationProject | undefined;
  pathname: string;
}

function ObserveSection({
  showExpanded,
  project,
  pathname,
  codingAgentLinks,
  showAnalytics,
  analyticsEntry,
  showOnlineEvaluations,
}: ProjectSectionProps & {
  codingAgentLinks: CodingAgentLinks;
  showAnalytics: boolean;
  analyticsEntry: ReturnType<typeof useAnalyticsEntry>;
  showOnlineEvaluations: boolean;
}) {
  return (
    <SidebarSection id="observe" label="Observe" showExpanded={showExpanded}>
      {showAnalytics && analyticsEntry.isSettled && (
        <PageMenuLink
          path={analyticsEntry.path}
          icon={featureIcons.analytics.icon}
          label={projectNavItems.analytics.title}
          project={project}
          // Dashboards draws its own sidebar: an entry leading there is never active on /analytics.
          isActive={!analyticsEntry.leadsToDashboards && pathname.includes("/analytics")}
          showLabel={showExpanded}
        />
      )}
      <PageMenuLink
        path={projectNavItems.traces_v2.path}
        icon={featureIcons.traces_v2.icon}
        label={projectNavItems.traces_v2.title}
        project={project}
        isActive={pathname.includes("/traces")}
        showLabel={showExpanded}
      />
      {showOnlineEvaluations && (
        <PageMenuLink
          path={projectNavItems.online_evaluations.path}
          icon={featureIcons.online_evaluations.icon}
          label="Online Evals"
          project={project}
          isActive={isOnlineEvaluationsActivePath(pathname)}
          showLabel={showExpanded}
        />
      )}
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
    >
      {[
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
    </CollapsibleMenuGroup>
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
  // holding both would give a person two links to the same work. Neither shows
  // while the flag is still loading, so the group never flips on arrival.
  const host = useNavigationHost();
  const { enabled: agentTestingEnabled, isLoading: agentTestingFlagLoading } = host.featureFlag(
    FrontendFlags.release_ui_agent_testing_v2_enabled,
  );

  return (
    <SidebarSection id="test" label="Test" showExpanded={showExpanded}>
      {!agentTestingFlagLoading && agentTestingEnabled && (
        <PageMenuLink
          path={projectNavItems.agent_testing.path}
          icon={featureIcons.agent_testing.icon}
          label={projectNavItems.agent_testing.title}
          project={project}
          isActive={pathname.includes("/agent-testing")}
          showLabel={showExpanded}
        />
      )}
      {!agentTestingFlagLoading && !agentTestingEnabled && (
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
    <SidebarSection
      id="library"
      label="Build"
      showExpanded={showExpanded}
      defaultExpanded={false}
      tourId="nav-group-build"
    >
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
  rightElement?: React.ReactNode;
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
  rightElement,
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
      rightElement={rightElement}
      showLabel={showLabel}
      beta={beta}
      betaLabel={betaLabel}
      legacy={legacy}
      legacyLabel={legacyLabel}
    />
  );
};
