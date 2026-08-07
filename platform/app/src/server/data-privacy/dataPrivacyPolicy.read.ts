import type { PrismaClient } from "@prisma/client";
import {
  batchScopePermissions,
  hasOrganizationPermission,
  hasProjectPermission,
} from "~/server/api/rbac";
import type { Session } from "~/server/auth";
import {
  type DataPrivacyConfig,
  dataPrivacyConfigSchema,
  type ResolvedDataPrivacy,
} from "./dataPrivacy.types";
import type { DataPrivacyScopeTier } from "./dataPrivacyPolicy.repository";
import { getDataPrivacyPolicyService } from "./dataPrivacyPolicy.service";
import { type DataPrivacyRow, resolveDataPrivacy } from "./resolveDataPrivacy";

export type ReadCtx = { prisma: PrismaClient; session: Session | null };

// hasOrganizationPermission / hasProjectPermission narrow their ctx to a
// non-null session (they early-return false when absent). protectedProcedure
// guarantees a session at runtime; mirror the model-defaults read cast.
type AuthedCtx = { prisma: PrismaClient; session: Session };

export type DataPrivacyRule = {
  scopeType: DataPrivacyScopeTier;
  scopeId: string;
  name: string;
  personalOnly: boolean;
  config: DataPrivacyConfig;
};

export type DataPrivacyScopeAvailable = {
  organization: { id: string; name: string } | null;
  departments: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; teamId: string }[];
};

export type DataPrivacyAudienceOptions = {
  /** The organization's custom RBAC groups (created on the enterprise plan;
   *  an org without any sees the group control empty and disabled). */
  groups: { id: string; name: string }[];
};

export type DataPrivacySnapshot = {
  projectId: string;
  /** Effective privacy policy for this project, every field populated by the
   *  cascade or the platform default. */
  effective: ResolvedDataPrivacy;
  /** The baseline a project in this team inherits before its own (and its
   *  department's) rules: the cascade stopping at the TEAM tier. Null for a
   *  personal-account project that has no team/org. */
  effectiveTeam: ResolvedDataPrivacy | null;
  /** The org-wide baseline: only ORGANIZATION rules and the platform defaults.
   *  Null for a personal-account project that has no org. */
  effectiveOrganization: ResolvedDataPrivacy | null;
  /** Rule rows the caller can read, one per (scope, personalOnly). */
  rules: DataPrivacyRule[];
  /** Scopes the caller can write to (RBAC-filtered), for the chip picker. */
  available: DataPrivacyScopeAvailable;
  /** Choices for the restrict-audience picker. */
  audienceOptions: DataPrivacyAudienceOptions;
};

/**
 * Snapshot for the Data Privacy settings page: the project's effective
 * policy, the readable rule rows, and the writable scopes for the chip
 * picker. Mirrors the retention snapshot (ADR-021): `available` is
 * RBAC-filtered and the rule list only includes scopes the caller can read,
 * so the org-wide policy landscape never leaks to a project-only viewer.
 *
 * ORGANIZATION and DEPARTMENT rules expose org-level policy, which a
 * project-only viewer must not see; both gate on organization:manage, the
 * same permission required to edit them.
 */
export async function getDataPrivacySnapshot(
  ctx: ReadCtx,
  params: { projectId: string },
): Promise<DataPrivacySnapshot> {
  const { projectId } = params;
  const service = getDataPrivacyPolicyService();

  const effective = await service.getResolvedForProject({ projectId });

  const project = await ctx.prisma.project.findUnique({
    where: { id: projectId },
    select: {
      teamId: true,
      team: {
        select: {
          organizationId: true,
          organization: { select: { id: true, name: true } },
        },
      },
    },
  });

  const organizationId = project?.team?.organizationId ?? null;
  const organizationName = project?.team?.organization?.name ?? null;

  if (!organizationId) {
    return await personalProjectSnapshot({
      ctx,
      projectId,
      effective,
      teamId: project?.teamId ?? "",
    });
  }

  return await organizationSnapshot({
    ctx,
    service,
    projectId,
    effective,
    organizationId,
    organizationName,
    teamId: project?.teamId ?? "",
  });
}

/** Personal-account project (no org/team): only its own PROJECT scope. */
async function personalProjectSnapshot({
  ctx,
  projectId,
  effective,
  teamId,
}: {
  ctx: ReadCtx;
  projectId: string;
  effective: ResolvedDataPrivacy;
  teamId: string;
}): Promise<DataPrivacySnapshot> {
  const canWrite = await hasProjectPermission(
    ctx as AuthedCtx,
    projectId,
    "project:update",
  );
  const name =
    (
      await ctx.prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true },
      })
    )?.name ?? projectId;
  return {
    projectId,
    effective,
    effectiveTeam: null,
    effectiveOrganization: null,
    rules: [],
    available: {
      organization: null,
      departments: [],
      teams: [],
      projects: canWrite ? [{ id: projectId, name, teamId }] : [],
    },
    audienceOptions: { groups: [] },
  };
}

type PolicyService = ReturnType<typeof getDataPrivacyPolicyService>;

function loadOrganizationScopes({
  ctx,
  service,
  organizationId,
}: {
  ctx: ReadCtx;
  service: PolicyService;
  organizationId: string;
}) {
  return Promise.all([
    ctx.prisma.department.findMany({
      where: { organizationId },
      select: { id: true, name: true, archivedAt: true },
      orderBy: { name: "asc" },
    }),
    ctx.prisma.team.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    ctx.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true, name: true, teamId: true },
      orderBy: { name: "asc" },
    }),
    ctx.prisma.group.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    service.listOrganizationRules({ organizationId }),
    hasOrganizationPermission(
      ctx as AuthedCtx,
      organizationId,
      "organization:manage",
    ),
  ]);
}

function loadScopePermissions({
  ctx,
  organizationId,
  orgTeams,
  orgProjects,
}: {
  ctx: ReadCtx;
  organizationId: string;
  orgTeams: { id: string }[];
  orgProjects: { id: string; teamId: string }[];
}) {
  const projectTeamId: Record<string, string> = {};
  for (const p of orgProjects) projectTeamId[p.id] = p.teamId;

  return Promise.all([
    batchScopePermissions(ctx, {
      organizationId,
      teamIds: orgTeams.map((t) => t.id),
      projectIds: [],
      projectTeamId: {},
      permission: "team:manage",
    }),
    batchScopePermissions(ctx, {
      organizationId,
      teamIds: [],
      projectIds: orgProjects.map((p) => p.id),
      projectTeamId,
      permission: "project:update",
    }),
  ]);
}

type OrgScopes = Awaited<ReturnType<typeof loadOrganizationScopes>>;
type ScopePermissions = Awaited<ReturnType<typeof loadScopePermissions>>;

type ScopeAccess = {
  canManageOrg: boolean;
  teamManage: ScopePermissions[0];
  projectUpdate: ScopePermissions[1];
};

function canReadScope({
  scopeType,
  scopeId,
  access,
}: {
  scopeType: DataPrivacyScopeTier;
  scopeId: string;
  access: ScopeAccess;
}): boolean {
  if (scopeType === "ORGANIZATION" || scopeType === "DEPARTMENT") {
    return access.canManageOrg;
  }
  if (scopeType === "TEAM") {
    return access.teamManage.teams.get(scopeId) === true;
  }
  return access.projectUpdate.projects.get(scopeId) === true;
}

/** Parse every row once. A row whose stored config no longer parses is
 *  unrenderable and unresolvable; the repository already warns about it on the
 *  resolution path, so the snapshot just leaves it out. */
function parseRuleRows(rows: OrgScopes[4]): DataPrivacyRow[] {
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
  return allRows;
}

/**
 * The rule LIST is RBAC-filtered (a project-only viewer never sees org rules),
 * but the effective BASELINES are resolved from every row: a team/org baseline
 * is exactly what already folds into the project effective the viewer can see,
 * so it leaks nothing new. The TEAM baseline is the cascade stopping at the
 * project's team (non-personal); the ORGANIZATION baseline keeps only org
 * rules. Synthetic facts with empty narrower ids make those tiers no-ops.
 */
function resolveBaselines({
  allRows,
  organizationId,
  teamId,
}: {
  allRows: DataPrivacyRow[];
  organizationId: string;
  teamId: string;
}) {
  const effectiveTeam = resolveDataPrivacy({
    rows: allRows,
    facts: {
      organizationId,
      teamId,
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
  return { effectiveTeam, effectiveOrganization };
}

function buildReadableRules({
  allRows,
  scopes,
  organizationName,
  access,
}: {
  allRows: DataPrivacyRow[];
  scopes: OrgScopes;
  organizationName: string | null;
  access: ScopeAccess;
}): DataPrivacyRule[] {
  const [orgDepartments, orgTeams, orgProjects] = scopes;
  const departmentName = new Map(orgDepartments.map((d) => [d.id, d.name]));
  const teamName = new Map(orgTeams.map((t) => [t.id, t.name]));
  const projectName = new Map(orgProjects.map((p) => [p.id, p.name]));

  const scopeName = (
    scopeType: DataPrivacyScopeTier,
    scopeId: string,
  ): string => {
    if (scopeType === "ORGANIZATION") return organizationName ?? scopeId;
    if (scopeType === "DEPARTMENT") {
      return departmentName.get(scopeId) ?? scopeId;
    }
    if (scopeType === "TEAM") return teamName.get(scopeId) ?? scopeId;
    return projectName.get(scopeId) ?? scopeId;
  };

  const rules: DataPrivacyRule[] = [];
  for (const row of allRows) {
    const { scopeType, scopeId } = row;
    if (!canReadScope({ scopeType, scopeId, access })) continue;
    rules.push({
      scopeType,
      scopeId,
      name: scopeName(scopeType, scopeId),
      personalOnly: row.personalOnly,
      config: row.config,
    });
  }
  return rules;
}

function buildAvailableScopes({
  organizationId,
  organizationName,
  scopes,
  access,
}: {
  organizationId: string;
  organizationName: string | null;
  scopes: OrgScopes;
  access: ScopeAccess;
}): DataPrivacyScopeAvailable {
  const [orgDepartments, orgTeams, orgProjects] = scopes;
  const { canManageOrg, teamManage, projectUpdate } = access;
  return {
    organization: canManageOrg
      ? { id: organizationId, name: organizationName ?? organizationId }
      : null,
    // Departments are an org-level lens: writable (and offered) only to org
    // managers. Archived departments stay out of the picker but keep their
    // names resolvable for existing rules above.
    departments: canManageOrg
      ? orgDepartments
          .filter((d) => d.archivedAt === null)
          .map(({ id, name }) => ({ id, name }))
      : [],
    teams: orgTeams
      .filter((t) => teamManage.teams.get(t.id))
      .map(({ id, name }) => ({ id, name })),
    projects: orgProjects
      .filter((p) => projectUpdate.projects.get(p.id))
      .map(({ id, name, teamId }) => ({ id, name, teamId })),
  };
}

type OrganizationSnapshotArgs = {
  ctx: ReadCtx;
  service: PolicyService;
  projectId: string;
  effective: ResolvedDataPrivacy;
  organizationId: string;
  organizationName: string | null;
  teamId: string;
};

async function organizationSnapshot({
  ctx,
  service,
  projectId,
  effective,
  organizationId,
  organizationName,
  teamId,
}: OrganizationSnapshotArgs): Promise<DataPrivacySnapshot> {
  const scopes = await loadOrganizationScopes({ ctx, service, organizationId });
  const [, orgTeams, orgProjects, orgGroups, rows, canManageOrg] = scopes;

  const [teamManage, projectUpdate] = await loadScopePermissions({
    ctx,
    organizationId,
    orgTeams,
    orgProjects,
  });
  const access: ScopeAccess = { canManageOrg, teamManage, projectUpdate };

  const allRows = parseRuleRows(rows);
  const { effectiveTeam, effectiveOrganization } = resolveBaselines({
    allRows,
    organizationId,
    teamId,
  });

  const rules = buildReadableRules({
    allRows,
    scopes,
    organizationName,
    access,
  });
  const available = buildAvailableScopes({
    organizationId,
    organizationName,
    scopes,
    access,
  });
  const audienceOptions: DataPrivacyAudienceOptions = { groups: orgGroups };

  return {
    projectId,
    effective,
    effectiveTeam,
    effectiveOrganization,
    rules,
    available,
    audienceOptions,
  };
}
