import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import type { Project } from "~/generated/prisma/client";
import { lwqlTenantCapability } from "~/server/analytics/lwql/capability";
import { lwqlConnectionFromEnv } from "~/server/analytics/lwql/executor";
import type { LwqlKeyMapRepository } from "~/server/analytics/lwql/lwqlKeyMap.repository";
import {
  type LwqlKeyMapRow,
  lwqlKeyMapTableQualifiedName,
  productionLangWatchQLNames,
} from "~/server/analytics/lwql/productionProvisioning";
import { parseConnectionUrl } from "~/server/clickhouse/goose";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import { generateApiKey } from "~/server/utils/apiKeyGenerator";
import { KSUID_RESOURCES } from "~/utils/constants";
import { captureException } from "~/utils/posthogErrorCapture";
import { slugify } from "~/utils/slugify";
import { mintProjectSlug } from "./projectSlug";
import type {
  PaginatedResult,
  PresenceConfig,
  ProjectRepository,
  ProjectWithTeam,
  SearchProjectsResult,
  TraceSharingConfig,
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

/** The refusal a personal team gives to anything that would add a project to it. */
export const PERSONAL_TEAM_PROJECT_CREATE_REFUSAL =
  "Projects cannot be created in a personal workspace. A personal workspace holds only the personal project provisioned with it.";

/** The refusal a personal project gives to anything that would archive it. */
export const PERSONAL_PROJECT_ARCHIVE_REFUSAL =
  "Personal workspace projects cannot be archived. A personal workspace is its project, and archiving it leaves the owner without one in this organization.";

/**
 * Whether moving a project between these two teams crosses the personal
 * workspace boundary, and the reason to give back if it does.
 *
 * A personal workspace is one team holding one project. `Project.isPersonal`
 * is a denormalized mirror of `Team.isPersonal` that plan-limit counting and
 * trace ingest read without a join, so a move across the boundary either hands
 * the organization a project no limit counts, or strands a shared project
 * inside one member's private space. Either way the personal team loses the
 * single project `PersonalWorkspaceService.ensure()` looks for, which breaks
 * that user's workspace permanently.
 *
 * Lives here rather than in either caller because the tRPC router writes
 * Prisma directly and never passes through this service, and an invariant
 * enforced twice is an invariant that eventually diverges.
 */
export function personalWorkspaceMoveViolation({
  isProjectPersonal,
  isDestinationTeamPersonal,
}: {
  isProjectPersonal: boolean;
  isDestinationTeamPersonal: boolean;
}): string | null {
  if (isProjectPersonal) return PERSONAL_PROJECT_MOVE_OUT_REFUSAL;
  if (isDestinationTeamPersonal) return PERSONAL_PROJECT_MOVE_IN_REFUSAL;
  return null;
}

/**
 * Whether archiving this project would take a personal workspace with it, and
 * the reason to give back if it would.
 *
 * `PersonalWorkspaceService` finds a workspace by its personal team still
 * holding an unarchived personal project. Archiving that project hides the
 * workspace from the lookup while the team keeps the one slot allowed per
 * (organization, owner), so the next `ensure()` can neither find the workspace
 * nor create a replacement.
 */
export function personalWorkspaceArchiveViolation(
  isProjectPersonal: boolean,
): string | null {
  return isProjectPersonal ? PERSONAL_PROJECT_ARCHIVE_REFUSAL : null;
}

/**
 * Whether creating a project in this team would put a second project in a
 * personal workspace, and the reason to give back if it would.
 *
 * The workspace is one team holding one project, and the owner is ADMIN of
 * their own team, so `project:create` passes there. A second project is
 * counted correctly by plan limits but sits somewhere team selection
 * deliberately hides, which is a project nobody but its owner can find.
 * `PersonalWorkspaceService` provisions the one project that belongs there
 * without going through this service.
 */
export function personalWorkspaceCreateViolation(
  isDestinationTeamPersonal: boolean,
): string | null {
  return isDestinationTeamPersonal
    ? PERSONAL_TEAM_PROJECT_CREATE_REFUSAL
    : null;
}

/**
 * How stale a coding-agent recency column has to be before it is rewritten.
 *
 * The columns are read against a window of days, so the moment inside that
 * window is not information anyone acts on. An hour keeps the busiest project
 * to twenty-four writes a day per column while still moving the value long
 * before the window closes on it.
 */
export const CODING_AGENT_ACTIVITY_TOUCH_MS = 60 * 60 * 1000;

/** What a caller recording coding-agent activity knows: the project, and when. */
export interface TouchCodingAgentActivityParams {
  projectId: string;
  at: Date;
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
    /**
     * Absent only where the caller cannot reach ClickHouse at all. A new
     * project's key-map row is then left to the deploy-time backfill, the
     * same way a failed write is.
     */
    private readonly lwqlKeyMap?: LwqlKeyMapRepository,
  ) {}

  async getById(id: string): Promise<Project | null> {
    return this.repo.getById(id);
  }

  /**
   * The destination has to be a live team of this organization, and not a
   * personal workspace: that holds only the project provisioned with it.
   */
  private async assertTeamCanHoldANewProject({
    teamId,
    organizationId,
  }: {
    teamId: string;
    organizationId: string;
  }): Promise<void> {
    const destinationTeam = await this.repo.findActiveTeamInOrganization({
      teamId,
      organizationId,
    });
    if (!destinationTeam) {
      throw new TeamNotInOrganizationError(
        "Team does not belong to this organization",
      );
    }
    const violation = personalWorkspaceCreateViolation(
      destinationTeam.isPersonal,
    );
    if (violation) {
      throw new PersonalWorkspaceBoundaryError(violation);
    }
  }

  async create(params: CreateProjectParams): Promise<Project> {
    if (!params.teamId && !params.newTeamName) {
      throw new Error("Either teamId or newTeamName must be provided");
    }

    let teamId: string;

    if (params.teamId) {
      await this.assertTeamCanHoldANewProject({
        teamId: params.teamId,
        organizationId: params.organizationId,
      });
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
    const slug = mintProjectSlug({ name: params.name, projectNanoId });

    const existing = await this.repo.findBySlugInTeam({ slug, teamId });
    if (existing) {
      throw new ProjectSlugConflictError(
        "A project with this name already exists in the selected team.",
      );
    }

    const project = await this.repo.create({
      id: projectId,
      name: params.name,
      slug,
      language: params.language,
      framework: params.framework,
      teamId,
      apiKey: generateApiKey(),
    });

    await this.syncLwqlKeyMapRow(project);

    return project;
  }

  /**
   * Best-effort: inserts this project's key-map row immediately, so it can
   * authenticate to LangWatchQL without waiting for the next scheduled
   * provisioning backfill (`src/tasks/provisionLwql.ts`). Never throws — a
   * failure here must not block project creation; the backfill task picks up
   * any row this misses on its next run. No-ops when LWQL is not configured.
   */
  private async syncLwqlKeyMapRow(project: Project): Promise<void> {
    const connection = lwqlConnectionFromEnv();
    if (!connection) return;

    if (!project.lwqlKey) {
      logger.error(
        { projectId: project.id },
        "new project has an empty lwqlKey — cannot sync its LangWatchQL key-map row; it will not be able to authenticate to LangWatchQL until this is corrected",
      );
      return;
    }

    try {
      const names = productionLangWatchQLNames({ connection });
      // Same qualification as the deploy-time task: the key-map table is
      // always migration 00084's, under the app's own ClickHouse database —
      // not `names.database`. See `lwqlKeyMapTableQualifiedName`'s doc
      // comment.
      const { database: sourceDatabase } = parseConnectionUrl();
      const row: LwqlKeyMapRow = {
        KeyHash: lwqlTenantCapability({ secret: project.lwqlKey }),
        TenantId: project.id,
      };
      if (!this.lwqlKeyMap) {
        throw new Error(
          "No LangWatchQL key-map repository is wired — the row was not written",
        );
      }
      await this.lwqlKeyMap.insertRow({
        table: lwqlKeyMapTableQualifiedName({
          names,
          sourceDatabase,
        }),
        row,
      });
    } catch (error) {
      logger.error(
        { projectId: project.id, error },
        "failed to sync lwql key-map row for new project; continuing — the scheduled provisioning backfill will pick it up",
      );
      captureException(new Error("Failed to sync lwql key-map row"), {
        extra: { projectId: project.id, error },
      });
    }
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

      // Read the project with its team so the guard only decides on projects
      // this organization actually owns. Deciding on an unscoped read would
      // let a caller tell a personal project from a shared one in someone
      // else's organization by the status code alone.
      const current = await this.repo.getWithTeam(id);
      if (
        current &&
        current.team.organizationId === organizationId &&
        current.teamId !== data.teamId
      ) {
        const violation = personalWorkspaceMoveViolation({
          isProjectPersonal: current.isPersonal,
          isDestinationTeamPersonal: team.isPersonal,
        });
        if (violation) {
          throw new PersonalWorkspaceBoundaryError(violation);
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
    // Scoped to this organization for the same reason the move guard is.
    const existing = await this.repo.getWithTeam(id);
    const archiveViolation =
      existing && existing.team.organizationId === organizationId
        ? personalWorkspaceArchiveViolation(existing.isPersonal)
        : null;
    if (archiveViolation) {
      throw new PersonalProjectProtectedError(archiveViolation);
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
      logger.error(
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
    /** See {@link ProjectRepository.findAllByOrganization}. */
    projectIds?: string[];
  }): Promise<PaginatedResult<Project>> {
    return this.repo.findAllByOrganization(params);
  }

  async getWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.repo.getWithTeam(id);
  }

  async updateMetadata(input: UpdateProjectMetadataInput): Promise<void> {
    return this.repo.updateMetadata(input);
  }

  /**
   * Record that a coding-agent session was folded for this project.
   *
   * Level-triggered and rate limited by {@link CODING_AGENT_ACTIVITY_TOUCH_MS}:
   * the only reader is a recency window measured in days, so a project that
   * folds a thousand sessions in an hour is worth exactly one write.
   */
  async touchCodingAgentSessionSeen({
    projectId,
    at,
  }: TouchCodingAgentActivityParams): Promise<void> {
    return this.repo.touchCodingAgentSessionSeen({
      projectId,
      at,
      staleBefore: new Date(at.getTime() - CODING_AGENT_ACTIVITY_TOUCH_MS),
    });
  }

  /**
   * Record that a pull request was mapped for a branch a session in this
   * project ran on. Same rate limit, its own column.
   */
  async touchCodingAgentPullRequestSeen({
    projectId,
    at,
  }: TouchCodingAgentActivityParams): Promise<void> {
    return this.repo.touchCodingAgentPullRequestSeen({
      projectId,
      at,
      staleBefore: new Date(at.getTime() - CODING_AGENT_ACTIVITY_TOUCH_MS),
    });
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
