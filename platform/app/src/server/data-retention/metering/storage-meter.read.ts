import type { PrismaClient } from "~/generated/prisma/client";
import { batchScopePermissions } from "~/server/api/rbac";
import type { Session } from "~/server/auth";
import type { ScopeTier } from "~/server/scopes/scope.types";
import type { DataRetentionService } from "@langwatch/data-retention-contract";

export type ReadCtx = { prisma: PrismaClient; session: Session | null };

export type StorageScopeUsage = {
  /** Total stored bytes across every in-scope project the caller can read. */
  totalBytes: number;
  /** How many projects contributed — lets the UI say "across N projects". */
  projectCount: number;
};

/**
 * Total stored bytes for the projects a scope resolves to, RBAC-filtered to the
 * ones the caller may read. The Data Storage card uses this so the number
 * tracks the page's scope selector (organization / team / project) instead of
 * only ever showing the project on the top nav.
 *
 * Projects are always enumerated FROM the caller's organization (a foreign
 * team/project id resolves to no rows), then narrowed to `traces:view` via the
 * batched permission check — so a wider scope can never surface a project's
 * storage the caller couldn't otherwise see. Summing delegates to the metering
 * service's per-tenant path, which keeps the hardened ClickHouse settings and
 * the 5-minute cache owned by the Data Retention service.
 */
export async function resolveScopeStorageUsage(
  ctx: ReadCtx,
  dataRetention: DataRetentionService,
  params: {
    projectId: string;
    scope: { scopeType: ScopeTier; scopeId: string };
  },
): Promise<StorageScopeUsage> {
  const { projectId, scope } = params;

  const project = await ctx.prisma.project.findFirst({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  const organizationId = project?.team?.organizationId ?? null;

  // Personal-account project (no org): the scope can only be the project
  // itself, already authorized by the route's project:view guard.
  if (!organizationId) {
    const totalBytes = await dataRetention.getTotalStorageBytes({
      tenantId: projectId,
    });
    return { totalBytes, projectCount: 1 };
  }

  // Enumerate candidate projects within the caller's org for the chosen scope.
  // The org constraint is what makes a foreign scopeId resolve to nothing.
  // `archivedAt: null` excludes archived projects — they're hidden from the nav
  // and every other project listing, so counting them here would inflate the
  // "N projects" the storage card reports beyond what the user can actually see.
  const where =
    scope.scopeType === "PROJECT"
      ? { id: scope.scopeId, team: { organizationId }, archivedAt: null }
      : scope.scopeType === "TEAM"
        ? { teamId: scope.scopeId, team: { organizationId }, archivedAt: null }
        : { team: { organizationId }, archivedAt: null };

  const candidates = await ctx.prisma.project.findMany({
    where,
    select: { id: true, teamId: true },
  });

  if (candidates.length === 0) {
    return { totalBytes: 0, projectCount: 0 };
  }

  const projectTeamId: Record<string, string> = {};
  for (const p of candidates) projectTeamId[p.id] = p.teamId;

  const { projects } = await batchScopePermissions(ctx, {
    organizationId,
    teamIds: [],
    projectIds: candidates.map((p) => p.id),
    projectTeamId,
    permission: "traces:view",
  });

  const authorizedIds = candidates
    .map((p) => p.id)
    .filter((id) => projects.get(id) === true);

  const totalBytes = await dataRetention.getTotalStorageBytesForTenants({
    tenantIds: authorizedIds,
  });
  return { totalBytes, projectCount: authorizedIds.length };
}
