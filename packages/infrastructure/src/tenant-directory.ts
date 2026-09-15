/**
 * Which organization a tenant belongs to, read off this process's own
 * Postgres directly, never `ProjectApi` (cycles back via its ClickHouse
 * tier). A wrong route is a data-leak bug, not a slow query, so refuse.
 */
import { PLATFORM_TENANT, type TenantDirectory } from "@langwatch/clickhouse-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

export type { TenantDirectory };

/**
 * The three reads that place a tenant, in the order the rule asks them: a
 * project is placed by the organization its team belongs to; an organization
 * places itself; and a user is placed nowhere in particular, because somebody
 * can be in several organizations and picking one would put their identity
 * history on a server chosen by accident.
 */
export function prismaTenantDirectory(prisma: PrismaClient): TenantDirectory {
  return {
    async organizationForTenant(tenantId: string): Promise<string | null> {
      if (tenantId === "") return null;

      const project = await prisma.project.findUnique({
        where: { id: tenantId },
        select: { team: { select: { organizationId: true } } },
      });
      const projectOrganizationId = project?.team?.organizationId;
      if (projectOrganizationId) return projectOrganizationId;

      const organization = await prisma.organization.findUnique({
        where: { id: tenantId },
        select: { id: true },
      });
      if (organization !== null) return tenantId;

      const user = await prisma.user.findUnique({
        where: { id: tenantId },
        select: { id: true },
      });
      if (user !== null) return PLATFORM_TENANT;

      return null;
    },
  };
}

const DEFAULT_MAX_CACHE_ENTRIES = 10_000;

/**
 * The same answers, remembered, so the two routed members share one lookup
 * instead of asking Postgres per statement. A NULL is deliberately not
 * cached, or a newly created tenant would stay unroutable until eviction.
 */
export function cachedTenantDirectory(
  directory: TenantDirectory,
  maxCacheEntries: number = DEFAULT_MAX_CACHE_ENTRIES,
): TenantDirectory {
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1) {
    throw new RangeError("maxCacheEntries must be a positive integer");
  }

  const cache = new Map<string, string>();

  return {
    async organizationForTenant(tenantId: string): Promise<string | null> {
      const remembered = cache.get(tenantId);
      if (remembered !== undefined) return remembered;

      const resolved = await directory.organizationForTenant(tenantId);
      if (resolved === null || resolved === "") return null;

      // Map preserves insertion order, so the first key is the oldest write.
      if (cache.size >= maxCacheEntries) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      cache.set(tenantId, resolved);
      return resolved;
    },
  };
}
