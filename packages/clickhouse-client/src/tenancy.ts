/**
 * Tenant routing, fail-closed.
 *
 * Some organisations are served by their own ClickHouse instance rather than
 * the shared one. Getting that wrong in either direction is a data-leak class
 * of bug, not a performance one: routing tenant A's read at tenant B's server
 * returns B's rows, and routing a private tenant's write at the shared server
 * puts their data somewhere they did not agree to.
 *
 * So every decision here is explicit and every unknown is an error. There is no
 * "fall back to shared and hope" path, because the shared instance is exactly
 * where a mistake is least visible - the query succeeds and returns plausible
 * rows.
 *
 * The lookup from tenant to organisation is cached, and the cache is bounded
 * and expiring. An unbounded cache that is never invalidated grows without
 * limit and, worse, pins a tenant to whichever organisation it had the first
 * time it was seen: move a project between organisations and it keeps reading
 * the old organisation's data until the process restarts.
 */

/** Where a tenant's statements should be sent. */
export type TenantRoute =
  | { kind: "shared" }
  | { kind: "private"; organizationId: string; url: string };

/** Raised when a tenant cannot be resolved. Never fall back on this. */
export class UnknownTenantError extends Error {
  constructor(public readonly tenantId: string) {
    super(
      `Cannot route ClickHouse statement: tenant "${tenantId}" has no known organisation. ` +
        "Refusing to fall back to the shared instance, which would read or write another tenant's data.",
    );
    this.name = "UnknownTenantError";
  }
}

/** Raised when two env vars claim the same organisation. */
export class DuplicateRouteError extends Error {
  constructor(organizationId: string, first: string, second: string) {
    super(
      `Two ClickHouse routes are configured for organisation "${organizationId}" ("${first}" and "${second}"). ` +
        "Refusing to guess which instance holds their data.",
    );
    this.name = "DuplicateRouteError";
  }
}

/** `CLICKHOUSE_URL__<label>__<organizationId>=<url>`; the label is for humans. */
export const PRIVATE_ROUTE_ENV_PREFIX = "CLICKHOUSE_URL__";

export interface RoutingTable {
  /** organizationId -> connection url. */
  readonly routes: ReadonlyMap<string, string>;
  /** Env vars that were present but unusable, for the caller to report. */
  readonly skipped: readonly { envVar: string; reason: string }[];
}

/**
 * Parse the routing table out of an environment bag.
 *
 * Pure and total: it never throws for a malformed entry, it collects those in
 * `skipped` so a caller can log them all at once rather than dying on the first
 * one at module load. The single exception is a duplicate organisation, which
 * is ambiguous rather than merely malformed - there is no safe way to pick.
 */
export function parseRoutingTable(
  env: Record<string, string | undefined>,
): RoutingTable {
  const routes = new Map<string, string>();
  const source = new Map<string, string>();
  const skipped: { envVar: string; reason: string }[] = [];

  for (const [envVar, value] of Object.entries(env)) {
    if (!envVar.startsWith(PRIVATE_ROUTE_ENV_PREFIX)) continue;

    if (value === undefined || value.trim() === "") {
      skipped.push({ envVar, reason: "empty value" });
      continue;
    }

    const suffix = envVar.slice(PRIVATE_ROUTE_ENV_PREFIX.length);
    const separator = suffix.lastIndexOf("__");
    const organizationId =
      separator >= 0 ? suffix.slice(separator + 2) : suffix;

    if (organizationId === "") {
      skipped.push({ envVar, reason: "no organization id in the name" });
      continue;
    }

    const existing = source.get(organizationId);
    if (existing !== undefined) {
      throw new DuplicateRouteError(organizationId, existing, envVar);
    }

    routes.set(organizationId, value.trim());
    source.set(organizationId, envVar);
  }

  return { routes, skipped };
}

/** Resolves a tenant to its organisation. Backed by the control-plane database. */
export interface TenantDirectory {
  /** Null means "no such tenant", which is an error, never a shared fallback. */
  organizationForTenant(tenantId: string): Promise<string | null>;
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface TenantRouterOptions {
  table: RoutingTable;
  directory: TenantDirectory;
  /**
   * How long a tenant->organisation answer may be reused. Bounded because the
   * mapping can change: a project can move organisation, and a stale answer
   * routes it at the wrong instance for as long as it is kept.
   */
  cacheTtlMs?: number | undefined;
  /** Bounds memory. The least-recently-resolved entry is dropped past this. */
  maxCacheEntries?: number | undefined;
  clock?: Clock | undefined;
}

export interface TenantRouter {
  route(tenantId: string): Promise<TenantRoute>;
  /** Drop a cached mapping. Call when a tenant's organisation changes. */
  invalidate(tenantId: string): void;
  invalidateAll(): void;
  /** Entries currently cached; exposed so a caller can meter the bound. */
  size(): number;
}

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_MAX_CACHE_ENTRIES = 10_000;

export function createTenantRouter({
  table,
  directory,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
  clock = systemClock,
}: TenantRouterOptions): TenantRouter {
  const cache = new Map<
    string,
    { organizationId: string; expiresAt: number }
  >();

  const remember = (tenantId: string, organizationId: string): void => {
    // Map preserves insertion order, so the first key is the oldest write.
    if (cache.size >= maxCacheEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(tenantId, {
      organizationId,
      expiresAt: clock.now() + cacheTtlMs,
    });
  };

  const organizationFor = async (tenantId: string): Promise<string> => {
    const cached = cache.get(tenantId);
    if (cached !== undefined && cached.expiresAt > clock.now()) {
      return cached.organizationId;
    }
    if (cached !== undefined) cache.delete(tenantId);

    const resolved = await directory.organizationForTenant(tenantId);
    if (resolved === null || resolved === "") {
      throw new UnknownTenantError(tenantId);
    }
    remember(tenantId, resolved);
    return resolved;
  };

  return {
    async route(tenantId) {
      if (tenantId === "") throw new UnknownTenantError(tenantId);

      const organizationId = await organizationFor(tenantId);
      const url = table.routes.get(organizationId);
      return url === undefined
        ? { kind: "shared" }
        : { kind: "private", organizationId, url };
    },
    invalidate(tenantId) {
      cache.delete(tenantId);
    },
    invalidateAll() {
      cache.clear();
    },
    size() {
      return cache.size;
    },
  };
}
