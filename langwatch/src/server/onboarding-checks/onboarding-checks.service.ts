import { ScenarioEventService } from "~/server/scenarios/scenario-event.service";
import { prisma } from "../db";

export type OnboardingCheckStatus = {
  workflows: number;
  customGraphs: number;
  datasets: number;
  evaluations: number;
  triggers: number;
  simulations: number;
  modelProviders: number;
  prompts: number;
  teamMembers: number;
  firstMessage: boolean;
  integrated: boolean;
};

/**
 * Service for checking onboarding status of a project
 */
export class OnboardingChecksService {
  /**
   * Get check status for a project
   * Returns counts of various entities and integration status
   */
  async getCheckStatus(projectId: string): Promise<OnboardingCheckStatus> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        workflows: {
          where: { archivedAt: null },
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        customGraphs: {
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        datasets: {
          where: { archivedAt: null },
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        experiments: {
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        triggers: {
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        team: {
          select: {
            members: {
              select: { userId: true },
            },
          },
        },
      },
    });

    // Project-visible MPs: any MP scoped at PROJECT, the project's TEAM,
    // or the project's ORG (matches `findAllAccessibleForProject` in
    // ModelProviderRepository). Project.modelProviders back-relation
    // was dropped when the legacy projectId column went away.
    const modelProviders = project
      ? await prisma.modelProvider.findFirst({
          where: {
            enabled: true,
            scopes: {
              some: { scopeType: "PROJECT", scopeId: projectId },
            },
          },
          select: { id: true },
        })
      : null;

    const {
      workflows,
      customGraphs,
      datasets,
      experiments,
      triggers,
      team,
    } = project ?? {};

    // Check for simulations (scenario sets in ClickHouse)
    const simulations = await this.getSimulationsCount(projectId);

    // Check for versioned prompts
    const prompts = await this.getPromptsCount(projectId);

    return {
      workflows: workflows?.length ?? 0,
      customGraphs: customGraphs?.length ?? 0,
      datasets: datasets?.length ?? 0,
      evaluations: experiments?.length ?? 0,
      triggers: triggers?.length ?? 0,
      simulations,
      modelProviders: modelProviders ? 1 : 0,
      prompts,
      teamMembers: team?.members?.length ?? 0,
      firstMessage: project?.firstMessage ?? false,
      integrated: project?.integrated ?? false,
    };
  }

  /**
   * Check for simulations (scenario sets in ClickHouse)
   */
  private async getSimulationsCount(projectId: string): Promise<number> {
    try {
      const scenarioService = new ScenarioEventService();
      const scenarioSets = await scenarioService.getScenarioSetsDataForProject({
        projectId,
      });
      return scenarioSets.length > 0 ? 1 : 0;
    } catch {
      // Silently fail if ClickHouse is unavailable
      return 0;
    }
  }

  /**
   * Check for versioned prompts (with at least one version)
   */
  private async getPromptsCount(projectId: string): Promise<number> {
    const prompt = await prisma.llmPromptConfig.findFirst({
      where: {
        projectId,
        deletedAt: null,
        versions: {
          some: {},
        },
      },
      select: { id: true },
    });
    return prompt ? 1 : 0;
  }
}
