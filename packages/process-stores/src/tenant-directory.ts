/**
 * Which organization a tenant belongs to, read off this process's own
 * Postgres directly, never `ProjectApi` (cycles back via its ClickHouse
 * tier). A wrong route is a data-leak bug, not a slow query, so refuse.
 */
import { PLATFORM_TENANT, type TenantDirectory } from "@langwatch/clickhouse-client";
import { SCHEDULED_SINGLETON_PROJECT_ID } from "@langwatch/eventing";

export type { TenantDirectory };

type RowById<Select, Row> = {
  findUnique(args: { where: { id: string }; select: Select }): PromiseLike<Row | null>;
};

/** The three reads the directory makes, which a `PrismaClient` answers as it is. */
export type TenantDirectoryRows = {
  project: RowById<
    { team: { select: { organizationId: true } } },
    { team: { organizationId: string } | null }
  >;
  organization: RowById<{ id: true }, { id: string }>;
  user: RowById<{ id: true }, { id: string }>;
};

/**
 * The three reads that place a tenant: a project by its team's organization,
 * an organization by itself, and a user nowhere in particular - they can be
 * in several organizations. A scheduled singleton belongs to none: shared.
 */
export function prismaTenantDirectory(prisma: TenantDirectoryRows): TenantDirectory {
  return {
    async organizationForTenant(tenantId: string): Promise<string | null> {
      if (tenantId === "") return null;
      if (tenantId === SCHEDULED_SINGLETON_PROJECT_ID) return PLATFORM_TENANT;

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
