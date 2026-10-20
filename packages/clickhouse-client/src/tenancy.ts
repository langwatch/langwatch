/**
 * Fail-closed tenant routing: a wrong route is a data-leak bug, not a
 * performance one, so every unknown is an error — never a silent fallback
 * to shared, which is where a mistake is least visible.
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

/** Why a recorded private organization is refused rather than served from the shared server. */
export type PrivateRouteProblem = "missing" | "malformed";

/** A private route the organization needs but this process cannot use. */
export interface PrivateRouteRefusal {
  readonly organizationId: string;
  /** The variable to set or fix, by name; never its value. */
  readonly variable: string;
  readonly problem: PrivateRouteProblem;
}

/** One private route variable as this process parsed it, by name; never its value. */
export interface PrivateRouteVariable {
  readonly organizationId: string;
  readonly label: string;
  readonly variable: string;
  readonly state: "present" | "malformed";
}

/** Raised when a private organization's route is missing or malformed. Never fall back on this. */
export class PrivateRouteUnavailableError extends Error {
  constructor(readonly refusal: PrivateRouteRefusal) {
    super(
      `Cannot route ClickHouse statement: organisation "${refusal.organizationId}" keeps its data on ` +
        `its own server, and ${refusal.variable} is ${refusal.problem}. ` +
        "Refusing to fall back to the shared instance.",
    );
    this.name = "PrivateRouteUnavailableError";
  }
}

/** Turns a refused private route into the error a caller sees; the plain error by default. */
export abstract class PrivateRouteRefusalFactory {
  abstract create(refusal: PrivateRouteRefusal): unknown;
}

/** The variable a recorded label names: `<prefix><label>__<organizationId>`. */
export function privateRouteVariableOf({
  prefix,
  label,
  organizationId,
}: {
  prefix: string;
  label: string;
  organizationId: string;
}): string {
  return label === "" ? `${prefix}${organizationId}` : `${prefix}${label}__${organizationId}`;
}

/** Splits a family variable's name: the organization follows the last `__`, the label before. */
export function privateRouteNameOf({ prefix, variable }: { prefix: string; variable: string }): {
  label: string;
  organizationId: string;
} {
  const suffix = variable.slice(prefix.length);
  const separator = suffix.lastIndexOf("__");
  return separator >= 0
    ? { label: suffix.slice(0, separator), organizationId: suffix.slice(separator + 2) }
    : { label: "", organizationId: suffix };
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export interface RoutingTable {
  /** organizationId -> connection url. */
  readonly routes: ReadonlyMap<string, string>;
  /** Env vars that were present but unusable, for the caller to report. */
  readonly skipped: readonly { envVar: string; reason: string }[];
  /**
   * A guessed `<label>__<organizationId>` split. Surface loudly: wrong, and
   * the intended organisation's tenants fall through to shared.
   */
  readonly ambiguous: readonly { envVar: string; organizationId: string }[];
  /** organizationId -> the variable naming its usable route. */
  readonly variables?: ReadonlyMap<string, string>;
  /** organizationId -> the variable naming its unusable route: refused, never shared. */
  readonly malformed?: ReadonlyMap<string, string>;
}

/**
 * Pure and total: never throws for a malformed entry (collected in
 * `skipped`), except a duplicate organisation — there's no safe way to pick.
 */
export function parseRoutingTable(env: Record<string, string | undefined>): RoutingTable {
  const routes = new Map<string, string>();
  const source = new Map<string, string>();
  const variables = new Map<string, string>();
  const malformed = new Map<string, string>();
  const skipped: { envVar: string; reason: string }[] = [];
  const ambiguous: { envVar: string; organizationId: string }[] = [];

  for (const [envVar, value] of Object.entries(env)) {
    if (!envVar.startsWith(PRIVATE_ROUTE_ENV_PREFIX)) continue;

    const { label, organizationId } = privateRouteNameOf({
      prefix: PRIVATE_ROUTE_ENV_PREFIX,
      variable: envVar,
    });

    if (organizationId === "") {
      skipped.push({ envVar, reason: "no organization id in the name" });
      continue;
    }

    // Guessing wrong here is a silent fail-open: the intended organisation
    // gets no route and its tenants fall through to shared.
    if (label.includes("__")) {
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
    source.set(organizationId, envVar);

    const url = value?.trim() ?? "";
    if (url === "" || !isUrl(url)) {
      skipped.push({ envVar, reason: url === "" ? "empty value" : "not a URL" });
      malformed.set(organizationId, envVar);
      continue;
    }

    routes.set(organizationId, url);
    variables.set(organizationId, envVar);
  }

  return { routes, skipped, ambiguous, variables, malformed };
}

/**
 * A user aggregate spans every organisation it belongs to, so membership
 * must not decide where it lands — placed on shared with no lookup.
 */
export const PLATFORM_TENANT = "__platform__" as const;

/** Resolves a tenant to its organisation. Backed by the control-plane database. */
export interface TenantDirectory {
  /** Null means "no such tenant" — an error, never a shared fallback. */
  organizationForTenant(tenantId: string): Promise<string | null>;
  /**
   * The private labels recorded for an organization the first time it was routed privately
   * (organization module). Absent: nothing is recorded, as before.
   */
  recordedPrivateDataplaneOf?(organizationId: string): Promise<RecordedPrivateDataplane>;
}

/** An organization's recorded private ClickHouse and S3 labels; null where none was seen. */
export interface RecordedPrivateDataplane {
  readonly clickhouseLabel: string | null;
  readonly s3Label: string | null;
}

export interface TenantRouterOptions {
  table: RoutingTable;
  directory: TenantDirectory;
  /**
   * Bounds memory only — a cached answer never goes stale (org membership
   * is fixed at creation), so eviction is the only reason to drop one.
   */
  maxCacheEntries?: number | undefined;
  /** What a refused private route throws; {@link PrivateRouteUnavailableError} by default. */
  refusal?: PrivateRouteRefusalFactory | undefined;
}

export interface TenantRouter {
  route(tenantId: string): Promise<TenantRoute>;
  /** Where a known organization's statements go; refuses a recorded private one with no route. */
  routeOrganization(organizationId: string): Promise<TenantRoute>;
  /** The organisation a tenant belongs to, from the same cached directory `route` reads. */
  organizationOf(tenantId: string): Promise<string>;
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

/** Map preserves insertion order, so the first key is the oldest write and is evicted first. */
function rememberBounded({
  cache,
  maxCacheEntries,
  tenantId,
  organizationId,
}: {
  cache: Map<string, string>;
  maxCacheEntries: number;
  tenantId: string;
  organizationId: string;
}): void {
  if (cache.size >= maxCacheEntries) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(tenantId, organizationId);
}

class PlainRefusal extends PrivateRouteRefusalFactory {
  create(refusal: PrivateRouteRefusal): unknown {
    return new PrivateRouteUnavailableError(refusal);
  }
}

/**
 * The platform tenant and any organization never recorded as private share the cluster. A
 * malformed route, or a recorded one now missing, is refused: never the shared server.
 */
async function routeForOrganization({
  table,
  directory,
  refusal,
  organizationId,
}: {
  table: TenantRouterOptions["table"];
  directory: TenantDirectory;
  refusal: PrivateRouteRefusalFactory;
  organizationId: string;
}): Promise<TenantRoute> {
  if (organizationId === PLATFORM_TENANT) return { kind: "shared" };
  const url = table.routes.get(organizationId);
  if (url !== undefined) return { kind: "private", organizationId, url };

  const broken = table.malformed?.get(organizationId);
  if (broken !== undefined) {
    throw refusal.create({ organizationId, variable: broken, problem: "malformed" });
  }
  const recorded = await directory.recordedPrivateDataplaneOf?.(organizationId);
  if (recorded?.clickhouseLabel != null) {
    const variable = privateRouteVariableOf({
      prefix: PRIVATE_ROUTE_ENV_PREFIX,
      label: recorded.clickhouseLabel,
      organizationId,
    });
    throw refusal.create({ organizationId, variable, problem: "missing" });
  }
  return { kind: "shared" };
}

export function createTenantRouter({
  table,
  directory,
  maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
  refusal = new PlainRefusal(),
}: TenantRouterOptions): TenantRouter {
  // `NaN` and `Infinity` both make `cache.size >= maxCacheEntries` false
  // forever, which removes the bound this option exists to impose and lets a
  // long-lived worker grow the map for the life of the process.
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1) {
    throw new RangeError("maxCacheEntries must be a positive integer");
  }

  const cache = new Map<string, string>();

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
    rememberBounded({ cache, maxCacheEntries, tenantId, organizationId: resolved });
    return resolved;
  };

  return {
    async route(tenantId) {
      if (tenantId === "") throw new UnknownTenantError(tenantId);

      const organizationId = await organizationFor(tenantId);
      return routeForOrganization({ table, directory, refusal, organizationId });
    },
    routeOrganization(organizationId) {
      return routeForOrganization({ table, directory, refusal, organizationId });
    },
    async organizationOf(tenantId) {
      if (tenantId === "") throw new UnknownTenantError(tenantId);

      return organizationFor(tenantId);
    },
    invalidateAll() {
      cache.clear();
    },
    size() {
      return cache.size;
    },
  };
}
