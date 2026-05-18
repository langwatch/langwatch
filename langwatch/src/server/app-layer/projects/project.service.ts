import type { Project } from "@prisma/client";
import { ProjectSensitiveDataVisibilityLevel } from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { env } from "~/env.mjs";
import { generateApiKey } from "~/server/utils/apiKeyGenerator";
import { KSUID_RESOURCES } from "~/utils/constants";
import { slugify } from "~/utils/slugify";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import type { ModelProviderService } from "../../modelProviders/modelProvider.service";
import {
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_RESOLUTION_ORDER,
} from "../../modelProviders/providerDefaultModels";
import type {
  PaginatedResult,
  PresenceConfig,
  ProjectRepository,
  ProjectWithTeam,
  SearchProjectsResult,
  UpdateProjectInput,
  UpdateProjectMetadataInput,
} from "./repositories/project.repository";

const logger = createLogger("langwatch:project-service");

/** All boolean fields on Project whose name starts with "feature". */
export type ProjectFeatureFlag = Extract<keyof Project, `feature${string}`>;

export interface OrgAdminResolution {
  userId: string | null;
  organizationId: string | null;
  firstMessage: boolean;
}

const NULL_RESOLUTION: OrgAdminResolution = {
  userId: null,
  organizationId: null,
  firstMessage: false,
};

export class ProjectNotFoundError extends Error {
  name = "ProjectNotFoundError" as const;
}

export class ProjectSlugConflictError extends Error {
  name = "ProjectSlugConflictError" as const;
}

export class TeamNotInOrganizationError extends Error {
  name = "TeamNotInOrganizationError" as const;
}

export interface CreateProjectParams {
  organizationId: string;
  userId?: string | null;
  teamId?: string;
  newTeamName?: string;
  name: string;
  language: string;
  framework: string;
}

export class ProjectService {
  constructor(
    readonly repo: ProjectRepository,
    private readonly modelProviderService?: ModelProviderService,
  ) {}

  async getById(id: string): Promise<Project | null> {
    return this.repo.getById(id);
  }

  async create(params: CreateProjectParams): Promise<Project> {
    if (!params.teamId && !params.newTeamName) {
      throw new Error("Either teamId or newTeamName must be provided");
    }

    let teamId: string;

    if (params.teamId) {
      const belongsToOrg = await this.repo.teamBelongsToOrganization({
        teamId: params.teamId,
        organizationId: params.organizationId,
      });
      if (!belongsToOrg) {
        throw new TeamNotInOrganizationError(
          "Team does not belong to this organization",
        );
      }
      teamId = params.teamId;
    } else {
      const teamName = params.newTeamName!;
      const teamNanoId = nanoid();
      const newTeamId = `team_${teamNanoId}`;
      const teamSlug =
        slugify(teamName, { lower: true, strict: true }) +
        "-" +
        newTeamId.substring(0, 6);

      if (params.userId) {
        await this.repo.createTeamWithRoleBinding({
          teamId: newTeamId,
          teamName,
          teamSlug,
          organizationId: params.organizationId,
          roleBindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          userId: params.userId,
        });
      } else {
        await this.repo.createTeam({
          teamId: newTeamId,
          teamName,
          teamSlug,
          organizationId: params.organizationId,
        });
      }

      teamId = newTeamId;
    }

    const projectNanoId = nanoid();
    const projectId = `project_${projectNanoId}`;
    const slug =
      slugify(params.name, { lower: true, strict: true }) +
      "-" +
      projectNanoId.substring(0, 6);

    const existing = await this.repo.findBySlugInTeam({ slug, teamId });
    if (existing) {
      throw new ProjectSlugConflictError(
        "A project with this name already exists in the selected team.",
      );
    }

    return this.repo.create({
      id: projectId,
      name: params.name,
      slug,
      language: params.language,
      framework: params.framework,
      teamId,
      apiKey: generateApiKey(),
      piiRedactionLevel:
        env.NODE_ENV === "development" || !env.IS_SAAS
          ? "DISABLED"
          : "ESSENTIAL",
      capturedInputVisibility:
        ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
      capturedOutputVisibility:
        ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
    });
  }

  async update({
    id,
    organizationId,
    data,
  }: {
    id: string;
    organizationId: string;
    data: UpdateProjectInput;
  }): Promise<Project> {
    const project = await this.repo.update({ id, organizationId, data });
    if (!project) throw new ProjectNotFoundError("Project not found");
    return project;
  }

  async archive({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<Project> {
    const project = await this.repo.archive({ id, organizationId });
    if (!project) throw new ProjectNotFoundError("Project not found");
    return project;
  }

  async listByOrganization(params: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<Project>> {
    return this.repo.findAllByOrganization(params);
  }

  async getWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.repo.getWithTeam(id);
  }

  async updateMetadata(input: UpdateProjectMetadataInput): Promise<void> {
    return this.repo.updateMetadata(input);
  }

  async searchByQuery(params: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]> {
    return this.repo.searchByQuery(params);
  }

  async isFeatureEnabled(
    projectId: string,
    flag: ProjectFeatureFlag,
  ): Promise<boolean> {
    const project = await this.repo.getById(projectId);
    return project ? Boolean(project[flag]) : false;
  }

  async getPresenceConfig(projectId: string): Promise<PresenceConfig | null> {
    return this.repo.getPresenceConfig(projectId);
  }

  /**
   * Single source of truth for the project's default model.
   *
   * Use this — not `project.defaultModel` directly — when you need to know
   * what model to use. The `project.defaultModel` column is the user-set
   * override; this method applies the full resolution chain:
   *
   *   1. If project.defaultModel is set AND its provider is enabled → return it.
   *   2. Else walk enabled providers in preferred order; return the first one
   *      that has a usable key (custom key OR env fallback) and a known
   *      canonical default model in PROVIDER_DEFAULT_MODELS.
   *   3. Else → return null.
   *
   * Returns null when no providers are usable (new self-host install with no
   * env vars set, or all providers disabled). Callers should treat null as
   * "not configured yet" and surface an appropriate message.
   */
  async resolveDefaultModel(projectId: string): Promise<string | null> {
    if (!this.modelProviderService) {
      // Null preset — no DB access available; fall through to null.
      return null;
    }

    const project = await this.repo.getById(projectId);
    if (!project) return null;

    const modelProviders =
      await this.modelProviderService.getProjectModelProviders(projectId, true);

    // 1. User override wins when its provider is still enabled.
    if (project.defaultModel) {
      const providerKey = project.defaultModel.split("/")[0] ?? "";
      if (modelProviders[providerKey]?.enabled) {
        return project.defaultModel;
      }
    }

    // 2. Walk providers in preferred order, return first usable canonical default.
    for (const providerId of PROVIDER_RESOLUTION_ORDER) {
      const provider = modelProviders[providerId];
      if (!provider?.enabled) continue;

      const canonicalModel = PROVIDER_DEFAULT_MODELS[providerId];
      if (!canonicalModel) continue;

      return canonicalModel;
    }

    // 3. Nothing usable.
    return null;
  }

  /**
   * Resolves the org admin userId from a projectId by traversing
   * Project -> Team -> Organization -> OrganizationUser (ADMIN).
   *
   * Returns nulls and defaults when the project or admin is not found,
   * or when the database lookup fails (non-fatal).
   */
  async resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution> {
    try {
      const result = await this.repo.getWithOrgAdmin(projectId);
      if (!result) return NULL_RESOLUTION;

      return {
        userId: result.adminUserId,
        organizationId: result.organizationId,
        firstMessage: result.firstMessage,
      };
    } catch (error) {
      logger.error(
        { projectId, error },
        "Failed to resolve org admin — returning null resolution",
      );
      captureException(new Error("Failed to resolve org admin"), {
        extra: { projectId, error },
      });
      return NULL_RESOLUTION;
    }
  }
}
