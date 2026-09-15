/**
 * Resolve the spend filters that name Postgres records into the ids
 * ClickHouse actually stores.
 *
 * A project filter is a tenant filter, a team filter is the set of projects
 * that team owns, and an external id is whatever the customer called a
 * virtual key on their side. None of those three reach a query as themselves:
 * gateway_spend stores tenant ids and virtual key ids and nothing else, so
 * the translation happens here, once, against the caller's own organization.
 *
 * A filter that resolves to nothing resolves to an EMPTY list, never to
 * "unfiltered". A team with no projects, or an external id nobody minted,
 * must answer with no spend rather than with the organization's entire
 * spend under a narrowing the caller asked for.
 */

import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * Reading every project of an organization is a cheap query that a
 * project-per-customer account runs on every page of every walk. Thirty
 * seconds is long enough to collapse a paging burst and short enough that a
 * project created mid-reconciliation shows up within one page.
 */
const PROJECT_CACHE_TTL_MS = 30_000;
/** Bounded so a busy multi-tenant process cannot grow this without limit. */
const PROJECT_CACHE_MAX_ORGS = 512;

interface CachedProjects {
  projects: Array<{ id: string; teamId: string }>;
  expiresAtMs: number;
}

/**
 * The resolver, holding its own cache and its own database.
 *
 * A class rather than module functions over a global client: the cache is
 * per-process state, and two processes composing this over different
 * databases must not share one map keyed only by organization id.
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
  }): Promise<Array<{ id: string; teamId: string }>> {
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
