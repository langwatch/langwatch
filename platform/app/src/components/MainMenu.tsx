import { GitPullRequest, SquareTerminal } from "lucide-react";
import type React from "react";
import type { Project } from "~/generated/prisma/client";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";
import { useRouter } from "~/utils/compat/next-router";
import { useFeatureFlag } from "../hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { api } from "../utils/api";
import { featureIcons } from "../utils/featureIcons";
import { projectRoutes } from "../utils/routes";
import { CollapsibleMenuGroup } from "./sidebar/CollapsibleMenuGroup";
import {
  CODING_AGENT_LINK_WINDOW_DAYS,
  withinDays,
} from "./sidebar/codingAgentActivity";
import {
  isExperimentsActivePath,
  isOnlineEvaluationsActivePath,
} from "./sidebar/navigationActiveState";
import { projectScopedDestination } from "./sidebar/projectScopedNav";
import { SidebarSection } from "./sidebar/SidebarSection";
import { SideMenuLink } from "./sidebar/SideMenuLink";

export const MENU_WIDTH_EXPANDED = "200px";
export const MENU_WIDTH_COMPACT = "56px";

/**
 * The project navigation sections (Home, Observe, Test, Build), rendered
 * by the LLM Ops sidebar. The Govern group is gone because the product
 * switcher replaces it, and the Ops group because the settings menu
 * holds the ops pages.
 *
 * Specs: specs/navigation/product-sidebars.feature,
 *        specs/navigation/ops-navigation-v2.feature
 */
export const MainMenuSections = function MainMenuSections({
  showExpanded,
}: {
  showExpanded: boolean;
}) {
  const router = useRouter();
  const { project, organization, hasPermission } = useOrganizationTeamProject();
  const pendingItemsCount = api.annotation.getPendingItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const codingAgentLinks = useCodingAgentLinks();

  const sectionProps = {
    showExpanded,
    project,
    organization,
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
    </>
  );
};

interface ProjectSectionProps {
  showExpanded: boolean;
  project: ReturnType<typeof useOrganizationTeamProject>["project"];
  organization: ReturnType<typeof useOrganizationTeamProject>["organization"];
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
      projectId: NOT_TARGETED,
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
  organization,
  pathname,
  pendingAnnotationCount,
}: ProjectSectionProps & { pendingAnnotationCount: number | undefined }) {
  // One destination replaces the Simulations group, and the two cannot both
  // be offered: they address the same runs through different routes, so a menu
  // holding both would give a person two links to the same work.
  // A rule may name the project or the organization, so the read waits until
  // both ids are known.
  const flagReadCanRun = !!project?.id && !!organization?.id;
  const { enabled: agentTestingEnabled, isLoading: flagReadLoading } =
    useFeatureFlag("release_ui_agent_testing_v2_enabled", {
      projectId: project?.id,
      organizationId: organization?.id,
      enabled: flagReadCanRun,
    });
  const { isLoading: workspaceLoading } = useOrganizationTeamProject();
  // Hide the choice only while the answer is still on its way. An account with
  // no project yet never gets an answer, and its menu still lists every
  // destination, so a loaded workspace with no ids falls back to Simulations.
  const agentTestingFlagLoading = workspaceLoading
    ? true
    : flagReadCanRun && flagReadLoading;

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
          organization={organization}
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
