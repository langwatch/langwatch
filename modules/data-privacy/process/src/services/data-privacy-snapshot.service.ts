/**
 * Everything one render of the data-privacy settings page is built from.
 */
import {
  dataPrivacyConfigSchema,
  namedApiKeyIds,
  resolveDataPrivacy,
  type DataPrivacyPolicy,
  type DataPrivacyRow,
  type DataPrivacyRule,
  type DataPrivacyScopeAvailable,
  type DataPrivacyScopeType,
  type DataPrivacySnapshot,
} from "@langwatch/data-privacy-contract";
import { createLogger } from "@langwatch/observability";
import { type Instant, nowInstant } from "@langwatch/time";

import type { DataPrivacyDirectoryReader } from "../app/data-privacy.app.ts";
import type { OrganizationApiKeys } from "../channels/data-privacy.channels.ts";
import { offerableApiKeys } from "../rules/audience-api-keys.rules.ts";
import type { DataPrivacyPermissionsService } from "./data-privacy-permissions.service.ts";
import type { PiiRedactionModelAcceptanceService } from "./pii-redaction-model-acceptance.service.ts";

const logger = createLogger("langwatch:data-privacy:snapshot");

/**
 * The two policy reads the snapshot stands on. Named structurally rather than as
 * `DataPrivacyService`, because the write half of that service drags an organization service
 * this read never asks anything of.
 */
type DataPrivacySnapshotPolicies = Readonly<{
  getResolvedForProject(input: { projectId: string }): Promise<DataPrivacySnapshot["effective"]>;
  listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]>;
}>;

type DataPrivacyDirectory = Awaited<
  ReturnType<DataPrivacyDirectoryReader["findOrganizationDirectory"]>
>;

/** Reading a scope: whether this user may see its rule, and what the scope is called. */
type ScopeLens = {
  canRead(scopeType: DataPrivacyScopeType, scopeId: string): boolean;
  nameOf(scopeType: DataPrivacyScopeType, scopeId: string): string;
};

type DataPrivacySnapshotDependencies = {
  policies: DataPrivacySnapshotPolicies;
  directory: DataPrivacyDirectoryReader;
  permissions: DataPrivacyPermissionsService;
  apiKeys: OrganizationApiKeys;
  acceptance: Pick<PiiRedactionModelAcceptanceService, "isAccepted">;
  clock?: () => Instant;
};

export class DataPrivacySnapshotService {
  static create(options: DataPrivacySnapshotDependencies): DataPrivacySnapshotService {
    return new DataPrivacySnapshotService({ clock: nowInstant, ...options });
  }

  private readonly policies: DataPrivacySnapshotPolicies;
  private readonly directory: DataPrivacyDirectoryReader;
  private readonly permissions: DataPrivacyPermissionsService;
  private readonly apiKeys: OrganizationApiKeys;
  private readonly acceptance: DataPrivacySnapshotDependencies["acceptance"];
  private readonly clock: () => Instant;

  private constructor(options: DataPrivacySnapshotDependencies & { clock: () => Instant }) {
    this.policies = options.policies;
    this.directory = options.directory;
    this.permissions = options.permissions;
    this.apiKeys = options.apiKeys;
    this.acceptance = options.acceptance;
    this.clock = options.clock;
  }

  async getSnapshot(input: { userId: string; projectId: string }): Promise<DataPrivacySnapshot> {
    const { userId, projectId } = input;
    const [effective, project] = await Promise.all([
      this.policies.getResolvedForProject({ projectId }),
      this.directory.findProjectLineage({ projectId }),
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
    const [directory, rows, canManageOrganization, piiRedactionModelAccepted] = await Promise.all([
      this.directory.findOrganizationDirectory({ organizationId }),
      this.policies.listOrganizationRules({ organizationId }),
      this.permissions.canManageOrganization({ userId, organizationId }),
      this.acceptance.isAccepted({ organizationId }),
    ]);

    const [teamManage, projectManage] = await Promise.all([
      this.permissions.canManageTeams({
        userId,
        organizationId,
        teamIds: directory.teams.map((team) => team.id),
      }),
      this.permissions.canManageProjects({
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
      projectManage,
    });
    const available = this.availableScopes({
      directory,
      organizationId,
      organizationName,
      canManageOrganization,
      teamManage,
      projectManage,
    });
    const allRows = this.parseRows(rows);
    const rules = this.visibleRules({ rows: allRows, lens });
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
      rules,
      available,
      audienceOptions: {
        groups: [...directory.groups],
        ...(await this.offerableKeys({
          organizationId,
          available,
          canManageOrganization,
          rules,
        })),
        canAddApiKeys: canManageOrganization,
      },
      piiRedactionModelAccepted,
    };
  }

  /**
   * ADR-208: an organization admin, who sees every key on the API keys page, is offered them
   * all; another editor only the keys the rules they can read already name; others none.
   */
  private async offerableKeys(input: {
    organizationId: string;
    available: DataPrivacyScopeAvailable;
    canManageOrganization: boolean;
    rules: readonly DataPrivacyRule[];
  }): Promise<{ apiKeys: { id: string; name: string }[]; apiKeysUnavailable?: true }> {
    const { available } = input;
    const canEditARule =
      available.organization !== null ||
      available.departments.length > 0 ||
      available.teams.length > 0 ||
      available.projects.length > 0;
    if (!canEditARule) return { apiKeys: [] };
    const named = new Set(input.rules.flatMap((rule) => namedApiKeyIds(rule.config)));
    if (!input.canManageOrganization && named.size === 0) return { apiKeys: [] };
    try {
      const keys = await this.apiKeys.listAll({ organizationId: input.organizationId });
      const offered = offerableApiKeys({ keys, now: this.clock() });
      return {
        apiKeys: input.canManageOrganization ? offered : offered.filter((key) => named.has(key.id)),
      };
    } catch (error) {
      // The page still opens; the picker offers no key until api-key answers again, and never
      // calls a key the rule names gone meanwhile.
      logger.warn({ error, organizationId: input.organizationId }, "API keys unavailable");
      return { apiKeys: [], apiKeysUnavailable: true };
    }
  }

  /** Who may read a scope's rule, and what that scope is called on the page. */
  private scopeLens(input: {
    directory: DataPrivacyDirectory;
    organizationName: string | null;
    canManageOrganization: boolean;
    teamManage: ReadonlyMap<string, boolean>;
    projectManage: ReadonlyMap<string, boolean>;
  }): ScopeLens {
    const { directory, organizationName, canManageOrganization, teamManage, projectManage } = input;
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

        return projectManage.get(scopeId) === true;
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
    projectManage: ReadonlyMap<string, boolean>;
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
        .filter((candidate) => input.projectManage.get(candidate.id) === true)
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
    const writable = await this.permissions.canManageProjects({
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
      audienceOptions: { groups: [], apiKeys: [], canAddApiKeys: false },
      // No organization, so nobody can accept the model's price for it.
      piiRedactionModelAccepted: false,
    };
  }
}
