import type { PrismaClient } from "@prisma/client";
import {
  batchScopePermissions,
  hasOrganizationPermission,
  hasProjectPermission,
} from "~/server/api/rbac";
import type { Session } from "~/server/auth";
import {
  dataPrivacyConfigSchema,
  type DataPrivacyConfig,
  type ResolvedDataPrivacy,
} from "./dataPrivacy.types";
import type { DataPrivacyScopeTier } from "./dataPrivacyPolicy.repository";
import { getDataPrivacyPolicyService } from "./dataPrivacyPolicy.service";

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

export type DataPrivacySnapshot = {
  projectId: string;
  /** Effective privacy policy for this project, every field populated by the
   *  cascade or the platform default. */
  effective: ResolvedDataPrivacy;
  /** Rule rows the caller can read, one per (scope, personalOnly). */
  rules: DataPrivacyRule[];
  /** Scopes the caller can write to (RBAC-filtered), for the chip picker. */
  available: DataPrivacyScopeAvailable;
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
    // Personal-account project (no org/team): only its own PROJECT scope.
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
      rules: [],
      available: {
        organization: null,
        departments: [],
        teams: [],
        projects: canWrite
          ? [{ id: projectId, name, teamId: project?.teamId ?? "" }]
          : [],
      },
    };
  }

  const [orgDepartments, orgTeams, orgProjects, rows, canManageOrg] =
    await Promise.all([
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
      service.listOrganizationRules({ organizationId }),
      hasOrganizationPermission(
        ctx as AuthedCtx,
        organizationId,
        "organization:manage",
      ),
    ]);

  const projectTeamId: Record<string, string> = {};
  for (const p of orgProjects) projectTeamId[p.id] = p.teamId;

  const [teamManage, projectUpdate] = await Promise.all([
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

  const departmentName = new Map(orgDepartments.map((d) => [d.id, d.name]));
  const teamName = new Map(orgTeams.map((t) => [t.id, t.name]));
  const projectName = new Map(orgProjects.map((p) => [p.id, p.name]));

  const canReadScope = (
    scopeType: DataPrivacyScopeTier,
    scopeId: string,
  ): boolean => {
    if (scopeType === "ORGANIZATION" || scopeType === "DEPARTMENT") {
      return canManageOrg;
    }
    if (scopeType === "TEAM") return teamManage.teams.get(scopeId) === true;
    return projectUpdate.projects.get(scopeId) === true;
  };

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
  for (const row of rows) {
    if (!canReadScope(row.scopeType, row.scopeId)) continue;
    // A row whose stored config no longer parses is unrenderable; the
    // repository already warns about it on the resolution path, so the
    // snapshot just leaves it out.
    const parsed = dataPrivacyConfigSchema.safeParse(row.config);
    if (!parsed.success) continue;
    rules.push({
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      name: scopeName(row.scopeType, row.scopeId),
      personalOnly: row.personalOnly,
      config: parsed.data,
    });
  }

  const available: DataPrivacyScopeAvailable = {
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

  return { projectId, effective, rules, available };
}
