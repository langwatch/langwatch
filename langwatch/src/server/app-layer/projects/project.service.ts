import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import { generateApiKey } from "~/server/utils/apiKeyGenerator";
import { KSUID_RESOURCES } from "~/utils/constants";
import { captureException } from "~/utils/posthogErrorCapture";
import { slugify } from "~/utils/slugify";
import type {
  PaginatedResult,
  PresenceConfig,
  TraceSharingConfig,
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

export class DestinationTeamNotFoundError extends Error {
  name = "DestinationTeamNotFoundError" as const;
}

export class PersonalWorkspaceBoundaryError extends Error {
  name = "PersonalWorkspaceBoundaryError" as const;
}

export class PersonalProjectProtectedError extends Error {
  name = "PersonalProjectProtectedError" as const;
}

/** The refusal a personal project gives to anything that would move it out. */
export const PERSONAL_PROJECT_MOVE_OUT_REFUSAL =
  "Personal workspace projects cannot be moved to another team. Create a project in the destination team instead.";

/** The refusal a personal team gives to anything that would move a project in. */
export const PERSONAL_PROJECT_MOVE_IN_REFUSAL =
  "Projects cannot be moved into a personal workspace. Personal workspaces hold only their owner's personal project.";

/** The refusal a personal project gives to anything that would archive it. */
export const PERSONAL_PROJECT_ARCHIVE_REFUSAL =
  "Personal workspace projects cannot be archived. A personal workspace is its project, and archiving it leaves the owner without one in this organization.";

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
  constructor(readonly repo: ProjectRepository) {}

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
    if (data.teamId) {
      const team = await this.repo.findActiveTeamInOrganization({
        teamId: data.teamId,
        organizationId,
      });
      if (!team) {
        throw new DestinationTeamNotFoundError(
          "Destination team not found, is archived, or belongs to a different organization",
        );
      }

      // Personal workspaces sit outside team moves in both directions.
      // `Project.isPersonal` is a denormalized mirror of `Team.isPersonal`
      // that plan-limit counting and trace ingest read without a join, so a
      // move across the personal boundary either hands the organization a
      // project no limit counts, or strands a shared project inside one
      // member's private space. It also leaves the personal team without the
      // single project `PersonalWorkspaceService.ensure()` looks for, which
      // breaks that user's workspace permanently.
      // Read the project with its team so the guard only fires for projects
      // this organization actually owns. Deciding on an unscoped read would
      // let a caller tell a personal project from a shared one in someone
      // else's organization by the status code alone.
      const current = await this.repo.getWithTeam(id);
      if (
        current &&
        current.team.organizationId === organizationId &&
        current.teamId !== data.teamId
      ) {
        if (current.isPersonal) {
          throw new PersonalWorkspaceBoundaryError(
            PERSONAL_PROJECT_MOVE_OUT_REFUSAL,
          );
        }
        if (team.isPersonal) {
          throw new PersonalWorkspaceBoundaryError(
            PERSONAL_PROJECT_MOVE_IN_REFUSAL,
          );
        }
      }
    }

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
    // A personal workspace is its project: PersonalWorkspaceService looks the
    // workspace up by the personal team still holding an unarchived personal
    // project. Archiving it hides the workspace from that lookup while the
    // team keeps the (organization, owner) uniqueness slot, so the next
    // ensure() can neither find the workspace nor create a replacement.
    const existing = await this.repo.getWithTeam(id);
    if (
      existing?.isPersonal &&
      existing.team.organizationId === organizationId
    ) {
      throw new PersonalProjectProtectedError(PERSONAL_PROJECT_ARCHIVE_REFUSAL);
    }

    // Cascade-delete stored-object bytes BEFORE the archive so BYOC S3 credentials
    // are still resolvable from the live project row. Wrapped in try/catch so a
    // cascade failure never blocks the user-facing project deletion — orphan bytes
    // can be swept up later, but a blocked deletion is a worse UX.
    try {
      await createStoredObjectsService({ projectId: id }).deleteOwnedBy({
        projectId: id,
      });
    } catch (error) {
      logger.warn(
        { projectId: id, error },
        "deleteOwnedBy failed during project archive; continuing with archive — orphan bytes may need manual cleanup",
      );
    }

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

  async getTraceSharingConfig(
    projectId: string,
  ): Promise<TraceSharingConfig | null> {
    return this.repo.getTraceSharingConfig(projectId);
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
