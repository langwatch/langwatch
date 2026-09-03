/**
 * Everything one render of the data-privacy settings page is built from.
 *
 * Moved out of `platform/app`'s `server/data-privacy/dataPrivacyPolicy.read.ts`
 * — the read model the wire shape in `@langwatch/data-privacy-contract` was
 * declared against and could not yet be pointed at. Every rule it applies is
 * the one the page has always been served:
 *
 *   - `available` is RBAC-filtered and the rule LIST only carries scopes the
 *     caller may read, so an organization's policy landscape never leaks to a
 *     project-only viewer. ORGANIZATION and DEPARTMENT rules expose
 *     organization-level policy, and both gate on `organization:manage` — the
 *     same permission required to edit them.
 *   - the effective BASELINES are resolved from EVERY row, filtered or not.
 *     A team or organization baseline is exactly what already folds into the
 *     project effective the viewer can see, so it discloses nothing new.
 *   - a stored configuration that no longer parses is left out rather than
 *     failing the page: it is unrenderable and unresolvable either way, and the
 *     repository already warns about it on the resolution path.
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
import type { DataPrivacyDirectoryPort } from "../ports/data-privacy-directory.port";
import type { DataPrivacyPermissionsPort } from "../ports/data-privacy-permissions.port";

/**
 * The two policy reads the snapshot stands on.
 *
 * Named structurally rather than as `DataPrivacyService`, because the write
 * half of that service drags an organization service this read never asks
 * anything of. `DataPrivacyResolutionService` satisfies it, and so does the
 * wider service that composes it.
 */
export type DataPrivacySnapshotPolicies = Readonly<{
  getResolvedForProject(input: { projectId: string }): Promise<DataPrivacySnapshot["effective"]>;
  listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]>;
}>;

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
    const organizationName = project?.organizationName ?? null;

    if (!organizationId) {
      return this.personalAccountSnapshot({ userId, projectId, effective, project });
    }

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

    const departmentName = new Map(directory.departments.map((row) => [row.id, row.name]));
    const teamName = new Map(directory.teams.map((row) => [row.id, row.name]));
    const projectName = new Map(directory.projects.map((row) => [row.id, row.name]));

    const canReadScope = (scopeType: DataPrivacyScopeType, scopeId: string): boolean => {
      if (scopeType === "ORGANIZATION" || scopeType === "DEPARTMENT") {
        return canManageOrganization;
      }
      if (scopeType === "TEAM") return teamManage.get(scopeId) === true;
      return projectUpdate.get(scopeId) === true;
    };

    const scopeName = (scopeType: DataPrivacyScopeType, scopeId: string): string => {
      if (scopeType === "ORGANIZATION") return organizationName ?? scopeId;
      if (scopeType === "DEPARTMENT") return departmentName.get(scopeId) ?? scopeId;
      if (scopeType === "TEAM") return teamName.get(scopeId) ?? scopeId;
      return projectName.get(scopeId) ?? scopeId;
    };

    const allRows: DataPrivacyRow[] = [];
    for (const row of rows) {
      const parsed = dataPrivacyConfigSchema.safeParse(row.config);
      if (!parsed.success) continue;
      allRows.push({
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        personalOnly: row.personalOnly,
        config: parsed.data,
      });
    }

    // Synthetic facts with empty narrower ids make those tiers no-ops, which is
    // what turns the one cascade into the two baselines the page compares
    // against.
    const effectiveTeam = resolveDataPrivacy({
      rows: allRows,
      facts: {
        organizationId,
        teamId: project?.teamId ?? "",
        projectId: "",
        departmentId: null,
        isPersonal: false,
      },
    });
    const effectiveOrganization = resolveDataPrivacy({
      rows: allRows,
      facts: {
        organizationId,
        teamId: "",
        projectId: "",
        departmentId: null,
        isPersonal: false,
      },
    });

    const rules: DataPrivacyRule[] = [];
    for (const row of allRows) {
      if (!canReadScope(row.scopeType, row.scopeId)) continue;
      rules.push({
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        name: scopeName(row.scopeType, row.scopeId),
        personalOnly: row.personalOnly,
        config: row.config,
      });
    }

    const available: DataPrivacyScopeAvailable = {
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
        .filter((team) => teamManage.get(team.id) === true)
        .map(({ id, name }) => ({ id, name })),
      projects: directory.projects
        .filter((candidate) => projectUpdate.get(candidate.id) === true)
        .map(({ id, name, teamId }) => ({ id, name, teamId })),
    };

    return {
      projectId,
      effective,
      effectiveTeam,
      effectiveOrganization,
      rules,
      available,
      audienceOptions: { groups: [...directory.groups] },
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
