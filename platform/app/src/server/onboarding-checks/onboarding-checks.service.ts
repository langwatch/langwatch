import { getApp } from "~/server/app-layer/app";
import { resolveScopeChain } from "~/server/scopes/resolveScopeChain";
import { prisma } from "../db";

export type OnboardingCheckStatus = {
  workflows: number;
  customGraphs: number;
  datasets: number;
  onlineEvaluations: number;
  triggers: number;
  simulations: number;
  modelProviders: number;
  prompts: number;
  teamMembers: number;
  firstMessage: boolean;
  integrated: boolean;
};

/** Shape selected by OnboardingChecksService.fetchProjectOnboardingData. */
interface ProjectOnboardingData {
  teamId: string;
  firstMessage: boolean;
  integrated: boolean;
  workflows: { id: string }[];
  customGraphs: { id: string }[];
  datasets: { id: string }[];
  checks: { id: string }[];
  triggers: { id: string }[];
  team: {
    organizationId: string;
    members: { userId: string }[];
  };
}

// Project-visible MPs: any enabled MP scoped at PROJECT, the project's TEAM,
// or the project's ORG. This mirrors the PROJECT -> TEAM -> ORGANIZATION
// cascade that `findAllAccessibleForProject` in ModelProviderRepository uses
// for real reads, so an org-wide provider counts toward every project under
// that org. Matching only the PROJECT scope left this step stuck incomplete
// for org-scoped credentials.
const hasAccessibleModelProvider = async ({
  project,
  projectId,
}: {
  project: ProjectOnboardingData | null;
  projectId: string;
}): Promise<boolean> => {
  if (!project) return false;

  const modelProvider = await prisma.modelProvider.findFirst({
    where: {
      enabled: true,
      scopes: {
        some: {
          OR: resolveScopeChain({
            organizationId: project.team.organizationId,
            teamId: project.teamId,
            projectId,
          }),
        },
      },
    },
    select: { id: true },
  });
  return modelProvider !== null;
};

const buildOnboardingCheckStatus = ({
  project,
  hasModelProvider,
  simulations,
  prompts,
}: {
  project: ProjectOnboardingData | null;
  hasModelProvider: boolean;
  simulations: number;
  prompts: number;
}): OnboardingCheckStatus => ({
  workflows: project?.workflows.length ?? 0,
  customGraphs: project?.customGraphs.length ?? 0,
  datasets: project?.datasets.length ?? 0,
  onlineEvaluations: project?.checks.length ?? 0,
  triggers: project?.triggers.length ?? 0,
  simulations,
  modelProviders: hasModelProvider ? 1 : 0,
  prompts,
  teamMembers: project?.team.members.length ?? 0,
  firstMessage: project?.firstMessage ?? false,
  integrated: project?.integrated ?? false,
});

/**
 * Service for checking onboarding status of a project
 */
export class OnboardingChecksService {
  /**
   * Get check status for a project
   * Returns counts of various entities and integration status
   */
  async getCheckStatus(projectId: string): Promise<OnboardingCheckStatus> {
    const project = await this.fetchProjectOnboardingData(projectId);

    const hasModelProvider = await hasAccessibleModelProvider({
      project,
      projectId,
    });

    // Check for simulations (scenario sets in ClickHouse)
    const simulations = await this.getSimulationsCount(projectId);

    // Check for versioned prompts
    const prompts = await this.getPromptsCount(projectId);

    return buildOnboardingCheckStatus({
      project,
      hasModelProvider,
      simulations,
      prompts,
    });
  }

  private async fetchProjectOnboardingData(
    projectId: string,
  ): Promise<ProjectOnboardingData | null> {
    return prisma.project.findUnique({
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
        checks: {
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
            organizationId: true,
            members: {
              select: { userId: true },
            },
          },
        },
      },
    });
  }

  /**
   * Check for simulations (scenario sets in ClickHouse)
   */
  private async getSimulationsCount(projectId: string): Promise<number> {
    try {
      const facade = getApp().simulations.runs;
      const scenarioSets = await facade.getScenarioSetsData({
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
