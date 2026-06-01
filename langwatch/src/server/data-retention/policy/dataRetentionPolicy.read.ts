import type { PrismaClient } from "@prisma/client";
import {
  batchScopePermissions,
  hasOrganizationPermission,
  hasProjectPermission,
} from "~/server/api/rbac";
import { getApp } from "~/server/app-layer/app";
import type { Session } from "~/server/auth";
import type { ScopeTier } from "~/server/scopes/scope.types";
import type {
  ResolvedRetention,
  RetentionCategory,
} from "../retentionPolicy.schema";

export type ReadCtx = { prisma: PrismaClient; session: Session | null };

// hasOrganizationPermission / hasProjectPermission narrow their ctx to a
// non-null session (they early-return false when absent). protectedProcedure
// guarantees a session at runtime; mirror the model-defaults read cast.
type AuthedCtx = { prisma: PrismaClient; session: Session };

export type RetentionScopeRef = {
  scopeType: ScopeTier;
  scopeId: string;
  name: string;
};

export type RetentionRule = RetentionScopeRef & {
  category: RetentionCategory;
  retentionDays: number;
};

export type ScopeAvailable = {
  organization: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; teamId: string }[];
};

export type RetentionPolicySnapshot = {
  projectId: string;
  /** Effective per-category retention for this project (0 = indefinite). */
  effective: ResolvedRetention;
  /** Override rows the caller can read, one per (scope, category). */
  rules: RetentionRule[];
  /** Scopes the caller can write to (RBAC-filtered), for the chip picker. */
  available: ScopeAvailable;
};

/**
 * Snapshot for the Data Retention settings page: the project's effective
 * retention, the readable override rows grouped as rules, and the writable
 * scopes for the chip picker. Mirrors the Default Models snapshot (ADR-021):
 * `available` is RBAC-filtered and the rule list only includes scopes the
 * caller can read, so the org-wide policy landscape never leaks to a
 * project-only viewer.
 */
export async function getRetentionPolicySnapshot(
  ctx: ReadCtx,
  params: { projectId: string },
): Promise<RetentionPolicySnapshot> {
  const { projectId } = params;
  const app = getApp();

  const effective =
    await app.dataRetention.policy.getResolvedForProject(projectId);

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
        teams: [],
        projects: canWrite
          ? [{ id: projectId, name, teamId: project?.teamId ?? "" }]
          : [],
      },
    };
  }

  const [orgTeams, orgProjects, rows, canManageOrg] = await Promise.all([
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
    app.dataRetention.policy.listOrganizationRules(organizationId),
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

  const teamName = new Map(orgTeams.map((t) => [t.id, t.name]));
  const projectName = new Map(orgProjects.map((p) => [p.id, p.name]));

  // A caller can read a rule's scope only if they have the corresponding
  // manage/update permission on it. Map.has() on the name maps only proves
  // org membership, which would leak unrelated team/project rule names —
  // AND the org-default retention number — to any user with project:view
  // in the same org.
  //
  // ORG-scope rules expose the org-default retention, which a project-only
  // viewer must not see (could be a negotiated SLA bound). Gate on
  // organization:manage, the same permission required to edit it.
  const canReadScope = (scopeType: ScopeTier, scopeId: string): boolean => {
    if (scopeType === "ORGANIZATION") return canManageOrg;
    if (scopeType === "TEAM") return teamManage.teams.get(scopeId) === true;
    return projectUpdate.projects.get(scopeId) === true;
  };

  const scopeName = (scopeType: ScopeTier, scopeId: string): string => {
    if (scopeType === "ORGANIZATION") return organizationName ?? scopeId;
    if (scopeType === "TEAM") return teamName.get(scopeId) ?? scopeId;
    return projectName.get(scopeId) ?? scopeId;
  };

  const rules: RetentionRule[] = rows
    .filter((r) => canReadScope(r.scopeType, r.scopeId))
    .map((r) => ({
      scopeType: r.scopeType,
      scopeId: r.scopeId,
      name: scopeName(r.scopeType, r.scopeId),
      category: r.category as RetentionCategory,
      retentionDays: r.retentionDays,
    }));

  const available: ScopeAvailable = {
    organization: canManageOrg
      ? { id: organizationId, name: organizationName ?? organizationId }
      : null,
    teams: orgTeams
      .filter((t) => teamManage.teams.get(t.id))
      .map(({ id, name }) => ({ id, name })),
    projects: orgProjects
      .filter((p) => projectUpdate.projects.get(p.id))
      .map(({ id, name, teamId }) => ({ id, name, teamId })),
  };

  return { projectId, effective, rules, available };
}
