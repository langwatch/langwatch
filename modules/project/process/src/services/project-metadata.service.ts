import {
  ProjectNotFoundError,
  type OrgAdminResolution,
  type Project,
  type ProjectWithTeam,
  type UpdateProjectMetadataInput,
} from "@langwatch/project-contract";

import type { ProjectRepository } from "../repositories/project.repository.ts";
import type { ProjectDiagnostics } from "./project.service.ts";

/**
 * Five repository-only operations for ingestion: reads and one write, composed
 * without the write graph ProjectService requires (no credentials/S3/orgService).
 */
export class ProjectMetadataService {
  private constructor(
    private readonly repository: ProjectRepository,
    private readonly diagnostics?: ProjectDiagnostics,
  ) {}

  static create(options: {
    repository: ProjectRepository;
    diagnostics?: ProjectDiagnostics;
  }): ProjectMetadataService {
    return new ProjectMetadataService(options.repository, options.diagnostics);
  }

  findById(projectId: string): Promise<Project | null> {
    return this.repository.findById(projectId);
  }

  findWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.repository.findWithTeam(id);
  }

  async getWithTeam(id: string): Promise<ProjectWithTeam> {
    const project = await this.repository.findWithTeam(id);
    if (!project) {
      throw new ProjectNotFoundError("Project not found");
    }

    return project;
  }

  updateMetadata(input: UpdateProjectMetadataInput): Promise<void> {
    return this.repository.updateMetadata(input);
  }

  async resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution> {
    try {
      const result = await this.repository.findWithOrgAdmin(projectId);
      if (!result) {
        return {
          userId: null,
          organizationId: null,
          firstMessage: false,
          onboardingVariant: null,
          organizationCreatedAt: null,
        };
      }

      return {
        userId: result.adminUserId,
        organizationId: result.organizationId,
        firstMessage: result.firstMessage,
        onboardingVariant: result.onboardingVariant,
        organizationCreatedAt: result.organizationCreatedAt,
      };
    } catch (error) {
      const resolution = {
        projectId,
        error,
      };
      this.diagnostics?.error(
        resolution,
        "Failed to resolve org admin — returning null resolution",
      );
      this.diagnostics?.capture(new Error("Failed to resolve org admin"), resolution);

      return {
        userId: null,
        organizationId: null,
        firstMessage: false,
        onboardingVariant: null,
        organizationCreatedAt: null,
      };
    }
  }
}
