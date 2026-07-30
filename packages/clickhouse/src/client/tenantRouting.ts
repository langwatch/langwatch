/**
 * The connection a tenant's queries and writes must reach. Two tenants that
 * share a `url` also share a connection pool (see {@link createPoolRegistry});
 * two tenants that share a `url` but not a `database` still pay for separate
 * schemas, so both fields travel together rather than as independent knobs.
 * Exists because today's single shared deployment (one url, one database, a
 * `TenantId` column) is one point in a space that also contains a dedicated
 * tenant with its own database, or its own ClickHouse endpoint entirely
 * (ADR-099, ADR-102).
 */
export interface TenantTarget {
  /** ClickHouse endpoint. */
  readonly url: string;
  /** Database the tenant's tables live in. */
  readonly database: string;
}

/**
 * Resolves a tenant to the connection it must use. Kept as its own seam,
 * rather than folded into the client, because the client should not have to
 * know whether the deployment is one shared database or a hundred dedicated
 * ones — that decision lives here (ADR-099).
 *
 * Resolving a target is never licence to drop the `TenantId` predicate from a
 * query. Routing is code, and code has bugs: a misrouted query that still
 * carries `WHERE TenantId = …` fails safe (wrong-empty result on the wrong
 * database); a misrouted query that dropped the predicate because "this
 * database is dedicated to one tenant anyway" fails as a cross-tenant
 * disclosure. `TenantId` leads every sort key, so the predicate is free.
 * Keep it on every query regardless of how the target was resolved.
 */
export interface TenantRouter {
  resolve(tenantId: string): TenantTarget;
  /** Every distinct target this router can produce, for ops paths that must
   *  enumerate databases — migrations, TTL reconciliation, drift checks. */
  knownTargets(): readonly TenantTarget[];
}

function requireCompleteTarget(target: TenantTarget, label: string): void {
  if (!target.url) {
    throw new Error(`${label} has an empty url`);
  }
  if (!target.database) {
    throw new Error(`${label} has an empty database`);
  }
}

/**
 * The identity of a target: both fields, never the url alone.
 *
 * One definition, used by everything that has to decide whether two targets are
 * the same one — the dedupe in {@link mappedTenantRouter} and the pool key in
 * {@link createPoolRegistry}. Two definitions of "same target" is how a pool
 * built for one database ends up serving another: `create` is handed the whole
 * target, so whatever it returns is bound to that target's database, and a
 * registry keyed on the url alone would hand that pool back for a different
 * one — a silent cross-database read, and on a dedicated-tenant target a
 * cross-tenant one.
 *
 * The separator is a NUL, written as an escape rather than as a literal control
 * character: a url may contain any printable character, so a printable
 * separator lets two different targets collide onto one key. A raw NUL in the
 * source would do the same job and read the same at runtime, but it makes the
 * file binary to `grep`, `git diff` and every other text tool, so a search of
 * this package silently skips it.
 */
function targetKey(target: TenantTarget): string {
  return `${target.url}\u0000${target.database}`;
}

function dedupeTargets(targets: readonly TenantTarget[]): TenantTarget[] {
  const seen = new Set<string>();
  const deduped: TenantTarget[] = [];
  for (const target of targets) {
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(target);
  }
  return deduped;
}

/**
 * A router for the deployment shape every tenant runs under today: one
 * database, separated by the `TenantId` column rather than by connection.
 * Validates its target eagerly so a blank url or database — a configuration
 * mistake — surfaces at startup rather than on the first query (ADR-099).
 */
export function sharedDatabaseRouter(target: TenantTarget): TenantRouter {
  requireCompleteTarget(target, "sharedDatabaseRouter target");

  return {
    resolve: () => target,
    knownTargets: () => [target],
  };
}

/**
 * A router for the mixed shape: most tenants share `fallback`, a named few
 * are pinned to their own target. Resolution is total — an unrecognised
 * tenant id resolves to `fallback` rather than throwing, because a brand new
 * tenant signing up must not fail its very first write while it waits to be
 * added to the map. Every target is validated when the router is built, not
 * when a query runs, so a mistyped override (empty url or database) is a
 * deploy-time failure instead of a query-time one (ADR-099, ADR-102).
 */
export function mappedTenantRouter(args: {
  fallback: TenantTarget;
  overrides: ReadonlyMap<string, TenantTarget>;
}): TenantRouter {
  const { fallback, overrides } = args;

  requireCompleteTarget(fallback, "mappedTenantRouter fallback target");
  for (const [tenantId, target] of overrides) {
    requireCompleteTarget(
      target,
      `mappedTenantRouter override for tenant "${tenantId}"`,
    );
  }

  const known = dedupeTargets([fallback, ...overrides.values()]);

  return {
    resolve: (tenantId) => overrides.get(tenantId) ?? fallback,
    knownTargets: () => known,
  };
}

/**
 * A registry of pools keyed by resolved {@link TenantTarget}, not by tenant.
 * Ten tenants resolving to one target share one pool; a dedicated tenant gets
 * its own. Keying by tenant instead would multiply connections by tenant
 * count against an endpoint whose connection capacity is fixed, and would
 * make the shared-deployment case — the common one — needlessly expensive
 * (ADR-099, ADR-102).
 *
 * The key is the whole target ({@link targetKey}), so two targets on one
 * endpoint but in different databases get one pool each. That is not a missed
 * saving: `create` receives the target, so the pool it builds is already bound
 * to that target's database, and returning it for another database would route
 * one tenant's queries at another's schema.
 */
export interface PoolRegistry<Pool> {
  acquire(target: TenantTarget): Pool;
  size(): number;
  closeAll(): Promise<void>;
}

/**
 * Builds a {@link PoolRegistry}. `maxPools`, when set, is enforced by
 * throwing on the acquire that would exceed it rather than by evicting an
 * existing pool: eviction would close sockets out from under whatever query
 * is mid-flight on that pool, turning a configuration mistake into a runtime
 * failure for an unrelated tenant. Throwing at the over-limit acquire is
 * recoverable — the caller (or its operator) can raise the limit or reduce
 * the number of distinct targets — and the limit exists at all because every
 * pool holds its own sockets against the endpoint (ADR-099).
 */
export function createPoolRegistry<Pool>(args: {
  create: (target: TenantTarget) => Pool;
  destroy?: (pool: Pool) => Promise<void>;
  maxPools?: number;
}): PoolRegistry<Pool> {
  const { create, destroy, maxPools } = args;
  const pools = new Map<string, Pool>();

  return {
    acquire(target: TenantTarget): Pool {
      const key = targetKey(target);
      const existing = pools.get(key);
      if (existing !== undefined) {
        return existing;
      }

      if (maxPools !== undefined && pools.size >= maxPools) {
        throw new Error(
          `pool registry is at its limit of ${maxPools} pool(s); refusing to open a new pool for url "${target.url}" database "${target.database}"`,
        );
      }

      const pool = create(target);
      pools.set(key, pool);
      return pool;
    },

    size(): number {
      return pools.size;
    },

    async closeAll(): Promise<void> {
      const held = [...pools.values()];
      pools.clear();
      if (!destroy) return;
      await Promise.all(held.map((pool) => destroy(pool)));
    },
  };
}
