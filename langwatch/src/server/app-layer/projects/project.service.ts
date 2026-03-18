import type { Project } from "@prisma/client";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import type {
  ProjectRepository,
  ProjectWithTeam,
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

export class ProjectService {
  constructor(readonly repo: ProjectRepository) {}

  async getById(id: string): Promise<Project | null> {
    return this.repo.getById(id);
  }

  async getWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.repo.getWithTeam(id);
  }

  async updateMetadata(input: UpdateProjectMetadataInput): Promise<void> {
    return this.repo.updateMetadata(input);
  }

  async isFeatureEnabled(
    projectId: string,
    flag: ProjectFeatureFlag,
  ): Promise<boolean> {
    const project = await this.repo.getById(projectId);
    return project ? Boolean(project[flag]) : false;
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
      captureException(error);
      return NULL_RESOLUTION;
    }
  }
}
