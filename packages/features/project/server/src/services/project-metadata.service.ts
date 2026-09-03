import {
  ProjectNotFoundError,
  type OrgAdminResolution,
  type Project,
  type ProjectWithTeam,
  type UpdateProjectMetadataInput,
} from "@langwatch/project-contract";
import type { ProjectDiagnosticsPort } from "../ports/project.port";
import type { ProjectRepository } from "../repositories/project.repository";

/**
 * The project reads and the one project write that ingestion performs.
 *
 * Five operations that stand on the repository and nothing else. They were
 * methods of `ProjectService`, which still answers all five — it composes this
 * and delegates, so there is one implementation and no twin to drift — but a
 * process that only ingests can now compose these WITHOUT the write graph.
 *
 * That distinction is the whole reason this class exists. `ProjectService`
 * requires a `ProjectCredentialsPort` and an `OrganizationService` because
 * `create` mints an id and an ingestion key and `ensureInternal` resolves a
 * team, and it takes a key map and a stored-object deleter because `create`
 * syncs the LWQL column mapping and `archive` removes a project's blobs. Not
 * one of those five collaborators is reached by any operation below: the
 * ingestion path never creates, never archives and never ensures. Composing
 * them to satisfy a constructor would put an organization graph, an authz
 * service and an S3 client in a process that folds spans.
 *
 * WHY `resolveOrgAdmin` SWALLOWS ITS FAILURE. The caller is the first-trace
 * milestone, which decides who to tell that a project started receiving data.
 * A read that fails there must not fail the ingestion that triggered it, so
 * the absence is reported as an empty resolution and the cause goes to
 * diagnostics. The behaviour moved here verbatim with the method.
 */
export class ProjectMetadataService {
  private constructor(
    private readonly repository: ProjectRepository,
    private readonly diagnostics?: ProjectDiagnosticsPort,
  ) {}

  static create(options: {
    repository: ProjectRepository;
    diagnostics?: ProjectDiagnosticsPort;
  }): ProjectMetadataService {
    return new ProjectMetadataService(options.repository, options.diagnostics);
  }

  tryGetById(projectId: string): Promise<Project | null> {
    return this.repository.tryGetById(projectId);
  }

  tryGetWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.repository.tryGetWithTeam(id);
  }

  async getWithTeam(id: string): Promise<ProjectWithTeam> {
    const project = await this.repository.tryGetWithTeam(id);
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
      const result = await this.repository.tryGetWithOrgAdmin(projectId);
      if (!result) {
        return { userId: null, organizationId: null, firstMessage: false };
      }

      return {
        userId: result.adminUserId,
        organizationId: result.organizationId,
        firstMessage: result.firstMessage,
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

      return { userId: null, organizationId: null, firstMessage: false };
    }
  }
}
