/**
 * Everything one render of the data-privacy settings page is built from.
 */
import {
  dataPrivacyConfigSchema,
  resolveDataPrivacy,
  type DataPrivacyPolicy,
  type DataPrivacyRow,
  type DataPrivacyRule,
  type DataPrivacyScopeAvailable,
  type DataPrivacyScopeType,
  type DataPrivacySnapshot,
} from "@langwatch/data-privacy-contract";
import type { DataPrivacyDirectoryPort } from "../ports/data-privacy-directory.port.ts";
import type { DataPrivacyPermissionsPort } from "../ports/data-privacy-permissions.port.ts";

/**
 * The two policy reads the snapshot stands on. Named structurally rather than as
 * `DataPrivacyService`, because the write half of that service drags an organization service
 * this read never asks anything of.
 */
export type DataPrivacySnapshotPolicies = Readonly<{
  getResolvedForProject(input: { projectId: string }): Promise<DataPrivacySnapshot["effective"]>;
  listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]>;
}>;

type DataPrivacyDirectory = Awaited<
  ReturnType<DataPrivacyDirectoryPort["listOrganizationDirectory"]>
>;

/** Reading a scope: whether this user may see its rule, and what the scope is called. */
type ScopeLens = {
  canRead(scopeType: DataPrivacyScopeType, scopeId: string): boolean;
  nameOf(scopeType: DataPrivacyScopeType, scopeId: string): string;
};

export class DataPrivacySnapshotService {
  static create(options: {
    policies: DataPrivacySnapshotPolicies;
    directory: DataPrivacyDirectoryPort;
    permissions: DataPrivacyPermissionsPort;
  }): DataPrivacySnapshotService {
    return new DataPrivacySnapshotService(options.policies, options.directory, options.permissions);
  }

  private constructor(
    private readonly policies: DataPrivacySnapshotPolicies,
    private readonly directory: DataPrivacyDirectoryPort,
    private readonly permissions: DataPrivacyPermissionsPort,
  ) {}

  async getSnapshot(input: { userId: string; projectId: string }): Promise<DataPrivacySnapshot> {
    const { userId, projectId } = input;
    const [effective, project] = await Promise.all([
      this.policies.getResolvedForProject({ projectId }),
      this.directory.tryGetProjectLineage({ projectId }),
    ]);

    const organizationId = project?.organizationId ?? null;
    if (!organizationId) {
      return this.personalAccountSnapshot({ userId, projectId, effective, project });
    }

    return this.organizationSnapshot({
      userId,
      projectId,
      effective,
      project,
      organizationId,
      organizationName: project?.organizationName ?? null,
    });
  }

  /** The snapshot for a project inside an organization: its cascade, its rules, its pickers. */
  private async organizationSnapshot(input: {
    userId: string;
    projectId: string;
    effective: DataPrivacySnapshot["effective"];
    project: { teamId: string | null } | null;
    organizationId: string;
    organizationName: string | null;
  }): Promise<DataPrivacySnapshot> {
    const { userId, projectId, organizationId, organizationName } = input;
    const [directory, rows, canManageOrganization] = await Promise.all([
      this.directory.listOrganizationDirectory({ organizationId }),
      this.policies.listOrganizationRules({ organizationId }),
      this.permissions.canManageOrganization({ userId, organizationId }),
    ]);

    const [teamManage, projectUpdate] = await Promise.all([
      this.permissions.canManageTeams({
        userId,
        organizationId,
        teamIds: directory.teams.map((team) => team.id),
      }),
      this.permissions.canUpdateProjects({
        userId,
        organizationId,
        projectIds: directory.projects.map((candidate) => candidate.id),
      }),
    ]);

    const lens = this.scopeLens({
      directory,
      organizationName,
      canManageOrganization,
      teamManage,
      projectUpdate,
    });
    const allRows = this.parseRows(rows);
    const baselines = this.baselineCascades({
      rows: allRows,
      organizationId,
      teamId: input.project?.teamId ?? "",
    });

    return {
      projectId,
      effective: input.effective,
      effectiveTeam: baselines.effectiveTeam,
      effectiveOrganization: baselines.effectiveOrganization,
      rules: this.visibleRules({ rows: allRows, lens }),
      available: this.availableScopes({
        directory,
        organizationId,
        organizationName,
        canManageOrganization,
        teamManage,
        projectUpdate,
      }),
      audienceOptions: { groups: [...directory.groups] },
    };
  }

  /** Who may read a scope's rule, and what that scope is called on the page. */
  private scopeLens(input: {
    directory: DataPrivacyDirectory;
    organizationName: string | null;
    canManageOrganization: boolean;
    teamManage: ReadonlyMap<string, boolean>;
    projectUpdate: ReadonlyMap<string, boolean>;
  }): ScopeLens {
    const { directory, organizationName, canManageOrganization, teamManage, projectUpdate } = input;
    const departmentName = new Map(directory.departments.map((row) => [row.id, row.name]));
    const teamName = new Map(directory.teams.map((row) => [row.id, row.name]));
    const projectName = new Map(directory.projects.map((row) => [row.id, row.name]));

    return {
      canRead: (scopeType, scopeId) => {
        if (scopeType === "ORGANIZATION" || scopeType === "DEPARTMENT") {
          return canManageOrganization;
        }

        if (scopeType === "TEAM") {
          return teamManage.get(scopeId) === true;
        }

        return projectUpdate.get(scopeId) === true;
      },
      nameOf: (scopeType, scopeId) => {
        if (scopeType === "ORGANIZATION") {
          return organizationName ?? scopeId;
        }

        if (scopeType === "DEPARTMENT") {
          return departmentName.get(scopeId) ?? scopeId;
        }

        if (scopeType === "TEAM") {
          return teamName.get(scopeId) ?? scopeId;
        }

        return projectName.get(scopeId) ?? scopeId;
      },
    };
  }

  /** The stored rules whose config still parses; anything else is not renderable. */
  private parseRows(rows: DataPrivacyPolicy[]): DataPrivacyRow[] {
    const allRows: DataPrivacyRow[] = [];
    for (const row of rows) {
      const parsed = dataPrivacyConfigSchema.safeParse(row.config);
      if (!parsed.success) {
        continue;
      }

      allRows.push({
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        personalOnly: row.personalOnly,
        config: parsed.data,
      });
    }

    return allRows;
  }

  /**
   * Synthetic facts with empty narrower ids make those tiers no-ops, which is
   * what turns the one cascade into the two baselines the page compares against.
   */
  private baselineCascades(input: {
    rows: DataPrivacyRow[];
    organizationId: string;
    teamId: string;
  }): {
    effectiveTeam: DataPrivacySnapshot["effectiveTeam"];
    effectiveOrganization: DataPrivacySnapshot["effectiveOrganization"];
  } {
    const { rows, organizationId, teamId } = input;

    return {
      effectiveTeam: resolveDataPrivacy({
        rows,
        facts: { organizationId, teamId, projectId: "", departmentId: null, isPersonal: false },
      }),
      effectiveOrganization: resolveDataPrivacy({
        rows,
        facts: {
          organizationId,
          teamId: "",
          projectId: "",
          departmentId: null,
          isPersonal: false,
        },
      }),
    };
  }

  /** The rules this reader may see, named for the scope each sits at. */
  private visibleRules(input: { rows: DataPrivacyRow[]; lens: ScopeLens }): DataPrivacyRule[] {
    return input.rows
      .filter((row) => input.lens.canRead(row.scopeType, row.scopeId))
      .map((row) => ({
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        name: input.lens.nameOf(row.scopeType, row.scopeId),
        personalOnly: row.personalOnly,
        config: row.config,
      }));
  }

  /** The scopes this reader may write a new rule at, as the pickers offer them. */
  private availableScopes(input: {
    directory: DataPrivacyDirectory;
    organizationId: string;
    organizationName: string | null;
    canManageOrganization: boolean;
    teamManage: ReadonlyMap<string, boolean>;
    projectUpdate: ReadonlyMap<string, boolean>;
  }): DataPrivacyScopeAvailable {
    const { directory, organizationId, organizationName, canManageOrganization } = input;

    return {
      organization: canManageOrganization
        ? { id: organizationId, name: organizationName ?? organizationId }
        : null,
      // Departments are an organization-level lens: writable, and offered, only
      // to organization managers. An archived department stays out of the
      // picker but keeps its name resolvable for the rules above.
      departments: canManageOrganization
        ? directory.departments.filter((row) => !row.archived).map(({ id, name }) => ({ id, name }))
        : [],
      teams: directory.teams
        .filter((team) => input.teamManage.get(team.id) === true)
        .map(({ id, name }) => ({ id, name })),
      projects: directory.projects
        .filter((candidate) => input.projectUpdate.get(candidate.id) === true)
        .map(({ id, name, teamId }) => ({ id, name, teamId })),
    };
  }

  /**
   * A personal-account project has no organization and no team, so the only
   * scope it can carry a rule at is its own.
   */
  private async personalAccountSnapshot(input: {
    userId: string;
    projectId: string;
    effective: DataPrivacySnapshot["effective"];
    project: { name: string; teamId: string | null } | null;
  }): Promise<DataPrivacySnapshot> {
    const writable = await this.permissions.canUpdateProjects({
      userId: input.userId,
      organizationId: null,
      projectIds: [input.projectId],
    });
    const canWrite = writable.get(input.projectId) === true;

    return {
      projectId: input.projectId,
      effective: input.effective,
      effectiveTeam: null,
      effectiveOrganization: null,
      rules: [],
      available: {
        organization: null,
        departments: [],
        teams: [],
        projects: canWrite
          ? [
              {
                id: input.projectId,
                name: input.project?.name ?? input.projectId,
                teamId: input.project?.teamId ?? "",
              },
            ]
          : [],
      },
      audienceOptions: { groups: [] },
    };
  }
}
