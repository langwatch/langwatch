/**
 * Resolve spend filters naming Postgres records into ids ClickHouse stores
 * (tenant and virtual key ids only). Resolves to nothing → EMPTY list, never
 * "unfiltered" — a team with no projects answers no spend, not everyone's.
 */

import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * Reading every org project is cheap but run on every page of every walk by
 * a project-per-customer account. Thirty seconds collapses a paging burst
 * yet is short enough a mid-reconciliation project shows within one page.
 */
const PROJECT_CACHE_TTL_MS = 30_000;
/** Bounded so a busy multi-tenant process cannot grow this without limit. */
const PROJECT_CACHE_MAX_ORGS = 512;

interface CachedProjects {
  projects: { id: string; teamId: string }[];
  expiresAtMs: number;
}

/**
 * The resolver, holding its own cache and database — a class rather than
 * module functions over a global client, since two processes composing
 * this over different databases must not share one org-keyed map.
 */
export class GatewaySpendScopeAdapter {
  static create(options: { database: PrismaClient }): GatewaySpendScopeAdapter {
    return new GatewaySpendScopeAdapter(options.database);
  }

  private readonly projectCache = new Map<string, CachedProjects>();

  private constructor(private readonly database: PrismaClient) {}

  private async organizationProjects({
    organizationId,
    nowMs,
  }: {
    organizationId: string;
    nowMs: number;
  }): Promise<{ id: string; teamId: string }[]> {
    const projectCache = this.projectCache;
    const prisma = this.database;
    const cached = projectCache.get(organizationId);
    if (cached && cached.expiresAtMs > nowMs) return cached.projects;
    const projects = await prisma.project.findMany({
      where: { team: { organizationId } },
      // Ordered so downstream client routing by the first tenant is stable.
      select: { id: true, teamId: true },
      orderBy: { id: "asc" },
    });
    if (projectCache.size >= PROJECT_CACHE_MAX_ORGS) {
      // Oldest insertion first: a plain FIFO eviction, since every entry costs
      // the same and none is worth tracking a recency order for.
      const oldest = projectCache.keys().next();
      if (!oldest.done) projectCache.delete(oldest.value);
    }
    projectCache.set(organizationId, {
      projects,
      expiresAtMs: nowMs + PROJECT_CACHE_TTL_MS,
    });
    return projects;
  }

  /** Drops every cached organization, for a caller that has just written a
   *  project and needs the next read to see it. */
  clearCache(): void {
    this.projectCache.clear();
  }

  async resolveSpendScope({
    organizationId,
    projectIds,
    teamIds,
    externalIds,
    nowMs = Date.now(),
  }: {
    organizationId: string;
    projectIds?: string[];
    teamIds?: string[];
    externalIds?: string[];
    nowMs?: number;
  }): Promise<{ tenantIds: string[]; virtualKeyIds?: string[] }> {
    const projects = await this.organizationProjects({ organizationId, nowMs });

    let tenantIds = projects;
    if (teamIds !== undefined) {
      const wanted = new Set(teamIds);
      tenantIds = tenantIds.filter((p) => wanted.has(p.teamId));
    }
    if (projectIds !== undefined) {
      const wanted = new Set(projectIds);
      tenantIds = tenantIds.filter((p) => wanted.has(p.id));
    }

    return {
      tenantIds: tenantIds.map((p) => p.id),
      virtualKeyIds:
        externalIds === undefined
          ? undefined
          : await this.virtualKeyIdsForExternalIds({ organizationId, externalIds }),
    };
  }

  private async virtualKeyIdsForExternalIds({
    organizationId,
    externalIds,
  }: {
    organizationId: string;
    externalIds: string[];
  }): Promise<string[]> {
    const keys = await this.database.virtualKey.findMany({
      where: { organizationId, externalId: { in: externalIds } },
      select: { id: true },
    });
    return keys.map((k) => k.id);
  }
}
