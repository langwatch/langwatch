/**
 * What the retention settings page renders: the project's effective retention, the override
 * rows the caller may read, and the scopes they may write to. RBAC-filtered at every tier and
 * deliberately so.
 */
import type {
  ResolvedRetention,
  RetentionPolicySnapshot,
  ScopeAssignment,
} from "@langwatch/data-retention-contract";
import type { DataRetentionDirectoryPort } from "../ports/data-retention-directory.port.ts";
import type { DataRetentionService } from "./data-retention.service.ts";
import type {
  DataRetentionPolicyService,
  RetentionActor,
} from "./data-retention-policy.service.ts";
import type { RetentionPermissionsService } from "./retention-permissions.service.ts";

export type DataRetentionSnapshotServiceOptions = Readonly<{
  retention: Pick<DataRetentionService, "getResolvedForProject" | "listOrganizationRules">;
  directory: DataRetentionDirectoryPort;
  permissions: RetentionPermissionsService;
  policy: Pick<DataRetentionPolicyService, "canConfigureRetention">;
}>;

type OrganizationDirectory = Awaited<
  ReturnType<DataRetentionDirectoryPort["listOrganizationDirectory"]>
>;

/** Reading a scope: whether this caller may see its row, and what the scope is called. */
type RetentionScopeLens = {
  canRead(scopeType: ScopeAssignment["scopeType"], scopeId: string): boolean;
  nameOf(scopeType: ScopeAssignment["scopeType"], scopeId: string): string;
};

export class DataRetentionSnapshotService {
  static create(options: DataRetentionSnapshotServiceOptions): DataRetentionSnapshotService {
    return new DataRetentionSnapshotService(options);
  }

  private constructor(private readonly options: DataRetentionSnapshotServiceOptions) {}

  async getSnapshot(input: {
    projectId: string;
    actor: RetentionActor;
  }): Promise<RetentionPolicySnapshot> {
    const { projectId, actor } = input;
    const { directory, retention } = this.options;

    const effective = await retention.getResolvedForProject({ projectId });
    const lineage = await directory.findProjectLineage({ projectId });
    const organizationId = lineage?.organizationId ?? null;

    if (!organizationId) {
      return this.personalAccountSnapshot({ projectId, effective, lineage, userId: actor.userId });
    }

    return this.organizationSnapshot({
      projectId,
      actor,
      effective,
      organizationId,
      organizationName: lineage?.organizationName ?? null,
    });
  }

  /**
   * Personal-account project (no organization or team): only its own PROJECT scope, and no
   * organization means no paid plan and no overrides.
   */
  private async personalAccountSnapshot(input: {
    projectId: string;
    effective: ResolvedRetention;
    lineage: { name: string; teamId: string | null } | null;
    userId: string;
  }): Promise<RetentionPolicySnapshot> {
    const { projectId, effective, lineage, userId } = input;
    const decided = await this.options.permissions.canUpdateProjects({
      userId,
      organizationId: null,
      projectIds: [projectId],
    });
    const canWrite = decided.get(projectId) === true;

    return {
      projectId,
      effective,
      rules: [],
      available: {
        organization: null,
        teams: [],
        projects: canWrite
          ? [{ id: projectId, name: lineage?.name ?? projectId, teamId: lineage?.teamId ?? "" }]
          : [],
      },
      canConfigureRetention: false,
    };
  }

  /** The snapshot for a project inside an organization: its rules and its writable scopes. */
  private async organizationSnapshot(input: {
    projectId: string;
    actor: RetentionActor;
    effective: ResolvedRetention;
    organizationId: string;
    organizationName: string | null;
  }): Promise<RetentionPolicySnapshot> {
    const { projectId, actor, effective, organizationId, organizationName } = input;
    const { directory, permissions, retention, policy } = this.options;
    const userId = actor.userId;

    const [organizationDirectory, rows, canManageOrganization, canConfigureRetention] =
      await Promise.all([
        directory.listOrganizationDirectory({ organizationId }),
        retention.listOrganizationRules({ organizationId }),
        permissions.canManageOrganization({ userId, organizationId }),
        policy.canConfigureRetention({ organizationId, actor }),
      ]);

    const [teamManage, projectUpdate] = await Promise.all([
      permissions.canManageTeams({
        userId,
        organizationId,
        teamIds: organizationDirectory.teams.map((team) => team.id),
      }),
      permissions.canUpdateProjects({
        userId,
        organizationId,
        projectIds: organizationDirectory.projects.map((project) => project.id),
      }),
    ]);

    const lens = this.scopeLens({
      organizationDirectory,
      organizationName,
      canManageOrganization,
      teamManage,
      projectUpdate,
    });

    return {
      projectId,
      effective,
      rules: rows
        .filter((row) => lens.canRead(row.scopeType, row.scopeId))
        .map((row) => ({
          scopeType: row.scopeType,
          scopeId: row.scopeId,
          name: lens.nameOf(row.scopeType, row.scopeId),
          category: row.category,
          retentionDays: row.retentionDays,
        })),
      available: {
        organization: canManageOrganization
          ? { id: organizationId, name: organizationName ?? organizationId }
          : null,
        teams: organizationDirectory.teams.filter((team) => teamManage.get(team.id) === true),
        projects: organizationDirectory.projects
          // Archived projects are hidden from the nav and can't be navigated
          // to, so they must not be offered as a scope to attach a new policy.
          .filter((project) => !project.archived && projectUpdate.get(project.id) === true)
          .map(({ id, name, teamId }) => ({ id, name, teamId })),
      },
      canConfigureRetention,
    };
  }

  /** Who may read a scope's override row, and what that scope is called on the page. */
  private scopeLens(input: {
    organizationDirectory: OrganizationDirectory;
    organizationName: string | null;
    canManageOrganization: boolean;
    teamManage: ReadonlyMap<string, boolean>;
    projectUpdate: ReadonlyMap<string, boolean>;
  }): RetentionScopeLens {
    const { organizationDirectory, organizationName, canManageOrganization } = input;
    const teamName = new Map(organizationDirectory.teams.map((team) => [team.id, team.name]));
    const projectName = new Map(
      organizationDirectory.projects.map((project) => [project.id, project.name]),
    );

    return {
      canRead: (scopeType, scopeId) => {
        if (scopeType === "ORGANIZATION") {
          return canManageOrganization;
        }

        if (scopeType === "TEAM") {
          return input.teamManage.get(scopeId) === true;
        }

        return input.projectUpdate.get(scopeId) === true;
      },
      nameOf: (scopeType, scopeId) => {
        if (scopeType === "ORGANIZATION") {
          return organizationName ?? scopeId;
        }

        if (scopeType === "TEAM") {
          return teamName.get(scopeId) ?? scopeId;
        }

        return projectName.get(scopeId) ?? scopeId;
      },
    };
  }
}
