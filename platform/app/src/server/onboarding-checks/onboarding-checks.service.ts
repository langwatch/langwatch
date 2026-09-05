import type { GuidedPath } from "~/features/guided-onboarding/paths";
import { getApp } from "~/server/app-layer/app";
import {
  parseGuidedOnboardingState,
  parseOnboardingVariant,
} from "~/server/onboarding/guided-onboarding.service";
import type { OnboardingVariant } from "~/server/schemas/sign-up-data.schema";
import { resolveScopeChain } from "~/server/scopes/resolveScopeChain";
import { prisma } from "../db";

/**
 * Where the organization's guided onboarding stands, read next to the
 * checks so the Home offer and the progress card share one query.
 */
export type GuidedOnboardingCheck = {
  /** Null for an organization that predates the experiment. */
  variant: OnboardingVariant | null;
  /** The picks in pick order. */
  paths: GuidedPath[];
  currentPath?: GuidedPath;
  donePaths: GuidedPath[];
};

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
  guidedOnboarding: GuidedOnboardingCheck;
};

function readGuidedOnboardingCheck(signupData: unknown): GuidedOnboardingCheck {
  const state = parseGuidedOnboardingState(signupData);
  return {
    variant: parseOnboardingVariant(signupData),
    paths: state.paths,
    currentPath: state.currentPath,
    donePaths: state.donePaths,
  };
}

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
            organization: { select: { signupData: true } },
            members: {
              select: { userId: true },
            },
          },
        },
      },
    });

    const modelProviders = project
      ? await this.getVisibleModelProviderCount({
          organizationId: project.team.organizationId,
          teamId: project.teamId,
          projectId,
        })
      : 0;

    const { workflows, customGraphs, datasets, checks, triggers, team } =
      project ?? {};

    // Check for simulations (scenario sets in ClickHouse)
    const simulations = await this.getSimulationsCount(projectId);

    // Check for versioned prompts
    const prompts = await this.getPromptsCount(projectId);

    return {
      guidedOnboarding: readGuidedOnboardingCheck(
        team?.organization?.signupData,
      ),
      workflows: workflows?.length ?? 0,
      customGraphs: customGraphs?.length ?? 0,
      datasets: datasets?.length ?? 0,
      onlineEvaluations: checks?.length ?? 0,
      triggers: triggers?.length ?? 0,
      simulations,
      modelProviders,
      prompts,
      teamMembers: team?.members?.length ?? 0,
      firstMessage: project?.firstMessage ?? false,
      integrated: project?.integrated ?? false,
    };
  }

  /**
   * Project-visible model providers: any enabled provider scoped at PROJECT,
   * the project's TEAM, or the project's ORG. This mirrors the PROJECT ->
   * TEAM -> ORGANIZATION cascade that `findAllAccessibleForProject` in
   * ModelProviderRepository uses for real reads, so an org-wide provider
   * counts toward every project under that org. Matching only the PROJECT
   * scope left this step stuck incomplete for org-scoped credentials.
   */
  private async getVisibleModelProviderCount({
    organizationId,
    teamId,
    projectId,
  }: {
    organizationId: string;
    teamId: string;
    projectId: string;
  }): Promise<number> {
    const provider = await prisma.modelProvider.findFirst({
      where: {
        enabled: true,
        scopes: {
          some: {
            OR: resolveScopeChain({ organizationId, teamId, projectId }),
          },
        },
      },
      select: { id: true },
    });
    return provider ? 1 : 0;
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
