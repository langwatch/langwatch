/**
 * What the retention settings page renders: the project's effective retention,
 * the override rows the caller may read, and the scopes they may write to.
 *
 * RBAC-filtered at every tier and deliberately so. `Map.has()` on a name map
 * only proves organization membership, which would leak unrelated team and
 * project rule names — AND the organization-default retention number — to any
 * member with `project:view` in the same organization. An ORGANIZATION-scoped
 * rule exposes a figure that can be a negotiated SLA bound, so it is gated on
 * `organization:manage`, the same permission required to edit it.
 */
import type {
  DataRetentionService,
  RetentionCategory,
  ResolvedRetention,
} from "@langwatch/data-retention-contract";
import type {
  DataRetentionDirectoryPort,
  RetentionScopeTarget,
} from "../ports/data-retention-directory.port";
import type { DataRetentionPermissionsPort } from "../ports/data-retention-permissions.port";
import type { DataRetentionPolicyService, RetentionActor } from "./data-retention-policy.service";

export type RetentionRule = Readonly<{
  scopeType: RetentionScopeTarget["scopeType"];
  scopeId: string;
  name: string;
  category: RetentionCategory;
  retentionDays: number;
}>;

export type RetentionScopeAvailability = Readonly<{
  organization: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; teamId: string }[];
}>;

export type RetentionPolicySnapshot = Readonly<{
  projectId: string;
  /**
   * Effective per-category retention for this project, falling back to the
   * platform-wide default when no override is set.
   */
  effective: ResolvedRetention;
  /** Override rows the caller can read, one per (scope, category). */
  rules: RetentionRule[];
  /** Scopes the caller can write to (RBAC-filtered), for the chip picker. */
  available: RetentionScopeAvailability;
  /**
   * Whether the organization's plan unlocks configurable retention. Free plans
   * see the snapshot but the UI must hide the add/edit/delete controls.
   */
  canConfigureRetention: boolean;
}>;

export type DataRetentionSnapshotServiceOptions = Readonly<{
  retention: Pick<DataRetentionService, "getResolvedForProject" | "listOrganizationRules">;
  directory: DataRetentionDirectoryPort;
  permissions: DataRetentionPermissionsPort;
  policy: Pick<DataRetentionPolicyService, "canConfigureRetention">;
}>;

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
    const { directory, permissions, retention, policy } = this.options;

    const effective = await retention.getResolvedForProject({ projectId });
    const lineage = await directory.tryGetProjectLineage({ projectId });
    const organizationId = lineage?.organizationId ?? null;
    const organizationName = lineage?.organizationName ?? null;
    const userId = actor.userId;

    if (!organizationId) {
      // Personal-account project (no organization or team): only its own
      // PROJECT scope, and no organization means no paid plan and no overrides.
      const decided = userId
        ? await permissions.canUpdateProjects({
            userId,
            organizationId: null,
            projectIds: [projectId],
          })
        : new Map<string, boolean>();
      const canWrite = decided.get(projectId) === true;
      return {
        projectId,
        effective,
        rules: [],
        available: {
          organization: null,
          teams: [],
          projects: canWrite
            ? [
                {
                  id: projectId,
                  name: lineage?.name ?? projectId,
                  teamId: lineage?.teamId ?? "",
                },
              ]
            : [],
        },
        canConfigureRetention: false,
      };
    }

    const [organizationDirectory, rows, canManageOrganization, canConfigureRetention] =
      await Promise.all([
        directory.listOrganizationDirectory({ organizationId }),
        retention.listOrganizationRules({ organizationId }),
        userId
          ? permissions.canManageOrganization({ userId, organizationId })
          : Promise.resolve(false),
        policy.canConfigureRetention({ organizationId, actor }),
      ]);

    const projectTeamId: Record<string, string> = {};
    for (const project of organizationDirectory.projects) {
      projectTeamId[project.id] = project.teamId;
    }

    const [teamManage, projectUpdate] = await Promise.all([
      userId
        ? permissions.canManageTeams({
            userId,
            organizationId,
            teamIds: organizationDirectory.teams.map((team) => team.id),
          })
        : Promise.resolve(new Map<string, boolean>()),
      userId
        ? permissions.canUpdateProjects({
            userId,
            organizationId,
            projectIds: organizationDirectory.projects.map((project) => project.id),
          })
        : Promise.resolve(new Map<string, boolean>()),
    ]);

    const teamName = new Map(organizationDirectory.teams.map((team) => [team.id, team.name]));
    const projectName = new Map(
      organizationDirectory.projects.map((project) => [project.id, project.name]),
    );

    const canReadScope = (
      scopeType: RetentionScopeTarget["scopeType"],
      scopeId: string,
    ): boolean => {
      if (scopeType === "ORGANIZATION") return canManageOrganization;
      if (scopeType === "TEAM") return teamManage.get(scopeId) === true;
      return projectUpdate.get(scopeId) === true;
    };

    const scopeName = (
      scopeType: RetentionScopeTarget["scopeType"],
      scopeId: string,
    ): string => {
      if (scopeType === "ORGANIZATION") return organizationName ?? scopeId;
      if (scopeType === "TEAM") return teamName.get(scopeId) ?? scopeId;
      return projectName.get(scopeId) ?? scopeId;
    };

    const rules: RetentionRule[] = rows
      .filter((row) => canReadScope(row.scopeType, row.scopeId))
      .map((row) => ({
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        name: scopeName(row.scopeType, row.scopeId),
        category: row.category,
        retentionDays: row.retentionDays,
      }));

    return {
      projectId,
      effective,
      rules,
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
}
