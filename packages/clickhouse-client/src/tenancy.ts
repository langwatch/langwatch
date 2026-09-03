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
 * The lookup from tenant to organisation is cached and the cache is bounded.
 * It does not expire, and that is deliberate rather than an omission: a
 * project belongs to a team and a team to an organisation, and neither link is
 * reassignable, so the answer is fixed once it is known. The bound exists for
 * memory alone, since a long-lived worker sees a great many tenants.
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
  constructor({
    organizationId,
    first,
    second,
  }: {
    organizationId: string;
    first: string;
    second: string;
  }) {
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
  /**
   * Env vars whose `<label>__<organizationId>` split was a guess, because the
   * part before the last separator contains one too. The route was still
   * created from the guess, but the caller should surface these loudly: if the
   * guess is wrong the intended organisation has no route at all and its
   * tenants fall through to the shared instance.
   */
  readonly ambiguous: readonly { envVar: string; organizationId: string }[];
}

/**
 * Parse the routing table out of an environment bag.
 *
 * Pure and total: it never throws for a malformed entry, it collects those in
 * `skipped` so a caller can log them all at once rather than dying on the first
 * one at module load. The single exception is a duplicate organisation, which
 * is ambiguous rather than merely malformed - there is no safe way to pick.
 */
export function parseRoutingTable(env: Record<string, string | undefined>): RoutingTable {
  const routes = new Map<string, string>();
  const source = new Map<string, string>();
  const skipped: { envVar: string; reason: string }[] = [];
  const ambiguous: { envVar: string; organizationId: string }[] = [];

  for (const [envVar, value] of Object.entries(env)) {
    if (!envVar.startsWith(PRIVATE_ROUTE_ENV_PREFIX)) continue;

    if (value === undefined || value.trim() === "") {
      skipped.push({ envVar, reason: "empty value" });
      continue;
    }

    const suffix = envVar.slice(PRIVATE_ROUTE_ENV_PREFIX.length);
    const separator = suffix.lastIndexOf("__");
    const organizationId = separator >= 0 ? suffix.slice(separator + 2) : suffix;

    if (organizationId === "") {
      skipped.push({ envVar, reason: "no organization id in the name" });
      continue;
    }

    // `<label>__<organizationId>` cannot be split unambiguously when either
    // half may itself contain the separator, and taking the last one is a
    // guess. Guessing wrong is not a parse error, it is a silent fail-open:
    // the intended organisation gets no route, so every one of its tenants
    // falls through to the shared instance and reads and writes there.
    //
    // Nothing here can tell which split was meant, so say so and let the
    // operator disambiguate rather than discovering it as misplaced data.
    if (suffix.slice(0, Math.max(separator, 0)).includes("__")) {
      ambiguous.push({ envVar, organizationId });
    }

    const existing = source.get(organizationId);
    if (existing !== undefined) {
      throw new DuplicateRouteError({
        organizationId,
        first: existing,
        second: envVar,
      });
    }

    routes.set(organizationId, value.trim());
    source.set(organizationId, envVar);
  }

  return { routes, skipped, ambiguous };
}

/** Resolves a tenant to its organisation. Backed by the control-plane database. */
export interface TenantDirectory {
  /** Null means "no such tenant", which is an error, never a shared fallback. */
  organizationForTenant(tenantId: string): Promise<string | null>;
}

export interface TenantRouterOptions {
  table: RoutingTable;
  directory: TenantDirectory;
  /**
   * Bounds memory. The oldest entry is dropped past this.
   *
   * This is the only reason the cache evicts. A tenant's organisation is fixed
   * at creation - a project belongs to a team, a team to an organisation, and
   * nothing reassigns either - so a cached answer cannot go stale and there is
   * no expiry to get right. What remains is a long-lived worker that sees many
   * tenants, which without a bound grows this map for the life of the process.
   */
  maxCacheEntries?: number | undefined;
}

export interface TenantRouter {
  route(tenantId: string): Promise<TenantRoute>;
  /**
   * Drop every cached mapping. Nothing in normal operation needs this - the
   * mapping is immutable - but it keeps a test deterministic and gives an
   * operator a way to clear state after a directory misconfiguration.
   */
  invalidateAll(): void;
  /** Entries currently cached; exposed so a caller can meter the bound. */
  size(): number;
}

const DEFAULT_MAX_CACHE_ENTRIES = 10_000;

export function createTenantRouter({
  table,
  directory,
  maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
}: TenantRouterOptions): TenantRouter {
  // `NaN` and `Infinity` both make `cache.size >= maxCacheEntries` false
  // forever, which removes the bound this option exists to impose and lets a
  // long-lived worker grow the map for the life of the process.
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1) {
    throw new RangeError("maxCacheEntries must be a positive integer");
  }

  const cache = new Map<string, string>();

  const remember = ({
    tenantId,
    organizationId,
  }: {
    tenantId: string;
    organizationId: string;
  }): void => {
    // Map preserves insertion order, so the first key is the oldest write.
    if (cache.size >= maxCacheEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(tenantId, organizationId);
  };

  const organizationFor = async (tenantId: string): Promise<string> => {
    const cached = cache.get(tenantId);
    if (cached !== undefined) return cached;

    const resolved = await directory.organizationForTenant(tenantId);
    if (resolved === null || resolved === "") {
      // Deliberately not cached. A tenant that does not exist yet is a
      // different thing from one that never will, and caching the negative
      // would make a newly created project unroutable until eviction.
      throw new UnknownTenantError(tenantId);
    }
    remember({ tenantId, organizationId: resolved });
    return resolved;
  };

  return {
    async route(tenantId) {
      if (tenantId === "") throw new UnknownTenantError(tenantId);

      const organizationId = await organizationFor(tenantId);
      const url = table.routes.get(organizationId);
      return url === undefined ? { kind: "shared" } : { kind: "private", organizationId, url };
    },
    invalidateAll() {
      cache.clear();
    },
    size() {
      return cache.size;
    },
  };
}
