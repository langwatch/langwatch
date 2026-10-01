import type { AuthzApi } from "@langwatch/authz-contract";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type {
  GuidedOnboardingCheck,
  IntegrationsCheckStatus,
} from "@langwatch/onboarding-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import type { GuidedOnboardingService } from "./guided-onboarding.service.ts";

/** The owners each checklist figure is counted by, as narrow slices of their apis. */
export type OnboardingChecksPeers = Readonly<{
  projects: Pick<ProjectApi, "getWithTeam">;
  workflows: Pick<WorkflowApi, "list">;
  dashboards: Pick<DashboardApi, "countUsage">;
  datasets: Pick<DatasetApi, "listDatasets">;
  monitors: Pick<MonitorApi, "countUsage">;
  scenarios: Pick<ScenarioApi, "getScenarioSetsData">;
  modelProviders: Pick<ModelProviderApi, "countEnabledInScopes">;
  prompts: Pick<PromptApi, "countVersionedPrompts">;
  permissions: Pick<AuthzApi, "listTeamMemberBindings">;
}>;

/** How far a project has been set up: main's onboarding checks, each figure asked of its owner. */
export class OnboardingChecksService {
  readonly #peers: OnboardingChecksPeers;
  readonly #guided: Pick<GuidedOnboardingService, "getStateWithVariant">;

  private constructor(parts: {
    peers: OnboardingChecksPeers;
    guided: Pick<GuidedOnboardingService, "getStateWithVariant">;
  }) {
    this.#peers = parts.peers;
    this.#guided = parts.guided;
  }

  static create(parts: {
    peers: OnboardingChecksPeers;
    guided: Pick<GuidedOnboardingService, "getStateWithVariant">;
  }): OnboardingChecksService {
    return new OnboardingChecksService(parts);
  }

  async getCheckStatus({ projectId }: { projectId: string }): Promise<IntegrationsCheckStatus> {
    const peers = this.#peers;
    const project = await peers.projects.getWithTeam(projectId);
    const organizationId = project.team.organizationId;
    const projectIds = [projectId];

    const [
      workflows,
      dashboards,
      datasets,
      monitors,
      simulations,
      modelProviders,
      prompts,
      teamMembers,
      guidedOnboarding,
    ] = await Promise.all([
      peers.workflows.list({ projectId }),
      peers.dashboards.countUsage({ projectIds }),
      peers.datasets.listDatasets({ projectId, page: 1, limit: 1 }),
      peers.monitors.countUsage({ projectIds }),
      this.#countSimulations(projectId),
      peers.modelProviders.countEnabledInScopes({
        scopes: [
          { scopeType: "ORGANIZATION", scopeId: organizationId },
          { scopeType: "TEAM", scopeId: project.teamId },
          { scopeType: "PROJECT", scopeId: projectId },
        ],
      }),
      peers.prompts.countVersionedPrompts({ projectId }),
      this.#countTeamMembers({ organizationId, teamId: project.teamId }),
      this.#readGuidedOnboarding(organizationId),
    ]);

    return {
      workflows: anyOf(workflows.length),
      customGraphs: anyOf(dashboards.charts),
      datasets: anyOf(datasets.data.length),
      onlineEvaluations: anyOf(monitors.monitors),
      simulations,
      modelProviders: anyOf(modelProviders),
      prompts: anyOf(prompts),
      teamMembers,
      firstMessage: project.firstMessage,
      integrated: project.integrated,
      guidedOnboarding,
    };
  }

  /** Main's rule: an unreachable ClickHouse leaves the step undone, not the answer failed. */
  async #countSimulations(projectId: string): Promise<number> {
    try {
      const scenarioSets = await this.#peers.scenarios.getScenarioSetsData({ projectId });
      return anyOf(scenarioSets.length);
    } catch {
      return 0;
    }
  }

  async #countTeamMembers(input: { organizationId: string; teamId: string }): Promise<number> {
    const bindings = await this.#peers.permissions.listTeamMemberBindings({
      organizationId: input.organizationId,
      teamIds: [input.teamId],
    });
    return new Set((bindings.get(input.teamId) ?? []).map((binding) => binding.userId)).size;
  }

  async #readGuidedOnboarding(organizationId: string): Promise<GuidedOnboardingCheck> {
    const state = await this.#guided.getStateWithVariant({ organizationId });
    return {
      variant: state.variant,
      paths: state.paths,
      ...(state.currentPath === undefined ? {} : { currentPath: state.currentPath }),
      donePaths: state.donePaths,
    };
  }
}

/** Main read each step with `take: 1`, so a step's figure is one when any exists. */
function anyOf(count: number): number {
  return count > 0 ? 1 : 0;
}
