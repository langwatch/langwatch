/**
 * The setup checklist the onboarding screens render, composed as its own feature.
 * `integrationsChecks.getCheckStatus` — nine other verticals' evidence plus the project's
 * own two columns, rolled up per project.
 */
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { IntegrationsChecksTrpcPorts } from "@langwatch/project-server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { createIntegrationsChecksTrpcRouter } from "./project-trpc.mount";

/**
 * Whether this project has run any simulation, for the checklist's own step. The evidence
 * is a scenario-set read in ClickHouse and the scenario vertical is not composed here, so
 * the step arrives as a port.
 */
export abstract class ApiSimulationEvidencePort {
  abstract hasAnySimulation(input: { projectId: string }): Promise<boolean>;
}

/**
 * Whether this project has a model provider attached and switched on, for the checklist's
 * own step. A port rather than a `prisma.modelProvider` read written here, and the reason
 * is the column next to the one this needs.
 */
export abstract class ApiModelProviderEvidencePort {
  abstract hasEnabledProvider(input: { projectId: string }): Promise<boolean>;
}

/** The setup checklist, exactly as the onboarding screens read it. */
export type ApiOnboardingCheckStatus = Readonly<{
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
}>;

/** The one namespace, built over the composed rollup. */
export type ComposedIntegrationsChecksFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createIntegrationsChecksTrpcRouter>;
}>;

/** Composes the setup checklist over this process's own connection. */
export function composeIntegrationsChecksFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  /** The provider step, read through the model-provider feature's own persistence. */
  modelProviders: ApiModelProviderEvidencePort;
  /** The simulations step, where the deployment composed a scenario read. */
  simulations?: ApiSimulationEvidencePort;
}): ComposedIntegrationsChecksFeature {
  const checklist = ApiOnboardingChecks.create({
    prisma: options.infrastructure.prisma,
    modelProviders: options.modelProviders,
    ...(options.simulations ? { simulations: options.simulations } : {}),
  });

  const ports: IntegrationsChecksTrpcPorts<ApiOnboardingCheckStatus> = {
    // Annotated rather than inferred from the port: an unannotated arrow is
    // context-sensitive, so the checklist's own shape would be resolved after
    // the call's type arguments were fixed and the client would be handed
    // `{}` instead of the rollup.
    getCheckStatus: (
      _ctx: unknown,
      input: Readonly<{ projectId: string }>,
    ): Promise<ApiOnboardingCheckStatus> => checklist.getCheckStatus(input.projectId),
  };

  return { router: (mount) => createIntegrationsChecksTrpcRouter({ ...mount, ports }) };
}

/**
 * The setup checklist on a process that composed no database.
 */
export function refusingIntegrationsChecksFeature(): ComposedIntegrationsChecksFeature {
  const ports: IntegrationsChecksTrpcPorts<ApiOnboardingCheckStatus> = {
    getCheckStatus: () => {
      throw new ApiIntegrationsChecksUnavailableError("The setup checklist");
    },
  };

  return { router: (mount) => createIntegrationsChecksTrpcRouter({ ...mount, ports }) };
}

/** A capability this deployment did not compose, refused by name. */
class ApiIntegrationsChecksUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiIntegrationsChecksUnavailableError";
  }
}

/** The checklist itself, fanned out over this process's own connection. */
class ApiOnboardingChecks {
  static create(dependencies: {
    prisma: PrismaClient;
    modelProviders: ApiModelProviderEvidencePort;
    simulations?: ApiSimulationEvidencePort;
  }): ApiOnboardingChecks {
    return new ApiOnboardingChecks(
      dependencies.prisma,
      dependencies.modelProviders,
      dependencies.simulations,
    );
  }

  private readonly logger: Pick<Logger, "warn"> = createLogger("langwatch:api:onboarding-checks");

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly modelProviders: ApiModelProviderEvidencePort,
    private readonly simulations: ApiSimulationEvidencePort | undefined,
  ) {}

  async getCheckStatus(projectId: string): Promise<ApiOnboardingCheckStatus> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        workflows: {
          where: { archivedAt: null },
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        customGraphs: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
        datasets: {
          where: { archivedAt: null },
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        checks: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
        triggers: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
        team: {
          select: { organizationId: true, members: { select: { userId: true } } },
        },
      },
    });

    const [modelProviders, simulations, prompts] = await Promise.all([
      this.modelProviders.hasEnabledProvider({ projectId }),
      this.hasAnySimulation(projectId),
      this.hasVersionedPrompt(projectId),
    ]);

    const { workflows, customGraphs, datasets, checks, triggers, team } = project ?? {};

    return {
      workflows: workflows?.length ?? 0,
      customGraphs: customGraphs?.length ?? 0,
      datasets: datasets?.length ?? 0,
      onlineEvaluations: checks?.length ?? 0,
      triggers: triggers?.length ?? 0,
      simulations: simulations ? 1 : 0,
      modelProviders: modelProviders ? 1 : 0,
      prompts: prompts ? 1 : 0,
      teamMembers: team?.members?.length ?? 0,
      firstMessage: project?.firstMessage ?? false,
      integrated: project?.integrated ?? false,
    };
  }

  private async hasAnySimulation(projectId: string): Promise<boolean> {
    if (!this.simulations) return false;
    try {
      return await this.simulations.hasAnySimulation({ projectId });
    } catch (error) {
      // The step reports "not started" rather than failing the whole
      // checklist: every other step still has an answer, and the screen is a
      // prompt to finish setting up rather than a report anybody acts on.
      this.logger.warn(
        { error, projectId },
        "simulation evidence unavailable; reporting the simulations step as not started",
      );
      return false;
    }
  }

  private async hasVersionedPrompt(projectId: string): Promise<boolean> {
    const prompt = await this.prisma.llmPromptConfig.findFirst({
      where: { projectId, deletedAt: null, versions: { some: {} } },
      select: { id: true },
    });
    return prompt !== null;
  }
}
