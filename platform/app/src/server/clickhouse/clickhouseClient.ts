import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import { prisma } from "../db";
import { _getSharedClickHouseClient } from "./client";
import { createManagedClickHouseClient } from "./managedClient";
import { unregisterClickHouseLimiter } from "./metrics";
import {
  PRIVATE_CH_ENV_PREFIX,
  type PrivateRoute,
  parseRouteKey,
} from "./privateRouteKey";

const logger = createLogger("langwatch:clickhouse:routing");

/**
 * Resolver function that returns the appropriate ClickHouseClient for a given
 * tenant — a project for most callers, an organization for the ones whose
 * aggregate is one. Repositories use this instead of holding a fixed client,
 * enabling per-tenant routing to private ClickHouse instances.
 *
 * The type is exported; a resolver is not. One is built in the composition
 * root (`presets.ts`) and travels from there by injection, so the only ways to
 * reach a client are a repository the App hands out and the App's own
 * resolver. An exported resolver would be a third door that any module could
 * open by import, which is the reason there isn't one.
 */
export type ClickHouseClientResolver = (
  tenantId: string,
) => Promise<ClickHouseClient>;

/**
 * Map of orgId → route, parsed from env vars at module load. The format and its
 * parsing live in `./privateRouteKey`.
 *
 * Zero runtime overhead — no DB queries, no decryption.
 */
const privateClickHouseUrls = parsePrivateEnvVars(
  PRIVATE_CH_ENV_PREFIX,
  "ClickHouse",
);

function parsePrivateEnvVars(
  prefix: string,
  label: string,
): Map<string, PrivateRoute & { url: string }> {
  const map = new Map<string, PrivateRoute & { url: string }>();
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix)) continue;

    if (!value || value.trim() === "") {
      logger.warn(
        { envVar: key },
        `Skipping private ${label} env var: empty value`,
      );
      continue;
    }

    const parsed = parseRouteKey({ key, prefix });
    if (!parsed) continue;
    const { orgId, cluster } = parsed;

    if (map.has(orgId)) {
      throw new Error(
        `Duplicate private ${label} config for orgId "${orgId}": env var "${key}" conflicts with an earlier definition.`,
      );
    }

    map.set(orgId, { orgId, cluster, url: value });
    logger.info(
      { orgId, cluster, envVar: key },
      `Loaded private ${label} URL from env var`,
    );
  }
  if (map.size > 0) {
    logger.info({ count: map.size }, `Private ${label} instances configured`);
  }
  return map;
}

/** Cache of custom ClickHouse clients keyed by organizationId. */
const customClientCache = new Map<string, ClickHouseClient>();

/** Cache of tenantId → organizationId to avoid repeated DB lookups. */
const tenantOrgCache = new Map<string, string>();

/**
 * Users whose identity events route to the shared instance. Cached apart from
 * `tenantOrgCache` because a user resolves to no organization at all — that
 * is the whole point of them — so there is nothing to key there.
 *
 * WITH A TTL, because unlike `tenantOrgCache` this caches something that
 * CHANGES. A project's owning organization is immutable; "this user belongs
 * to no private-dataplane organization" stops being true the moment they join
 * one. The cache was write-only, so a user resolved once before joining kept
 * having their identity events written to the shared platform log for the
 * rest of the process's life — the exact case the guard below exists for,
 * defeated by remembering the answer from before it mattered.
 */
const SHARED_USER_TENANT_TTL_MS = 60_000;
const sharedUserTenantCache = new Map<string, number>();

/** Whether this user is still known to be on the shared instance. */
function sharedUserTenantIsFresh(tenantId: string, nowMs: number): boolean {
  const at = sharedUserTenantCache.get(tenantId);
  if (at === undefined) return false;
  if (nowMs - at < SHARED_USER_TENANT_TTL_MS) return true;
  sharedUserTenantCache.delete(tenantId);
  return false;
}

/**
 * Returns the appropriate ClickHouse client for a given tenant.
 *
 * THREE kinds of tenant reach this function, one per kind of aggregate the
 * event store holds:
 *
 *   - a PROJECT, which is what a tenant was and mostly still is;
 *   - an ORGANIZATION, since the grants ledger (ADR-092 §13) put an
 *     aggregate per organization into the same store;
 *   - a USER, since the identity aggregate (D01, ADR-101 §6) is keyed by the
 *     person rather than by anything they belong to.
 *
 * The first two resolve the same way, because routing is per-organization
 * for both: a project contributes the organization that owns it, and an
 * organization contributes itself. That organization (cached) decides
 * whether a private ClickHouse env var applies.
 *
 * ── Why a USER is its own kind, and not resolved into an organization ───
 *
 * The user IS the tenant for a user-scoped aggregate, and the id stays the
 * user's. It is tempting to resolve one into an organization the way a
 * project resolves into its owner, and that is the trap: a tenant is a
 * PROJECT id, one user reaches many projects across many organizations, and
 * there is no "the organization" for them to contribute. Any mapping we
 * invented would be picking one of several equally true answers. The
 * identity aggregate is keyed by user precisely because the user is the
 * thing that persists across all of them.
 *
 * A single sentinel — routing every user-scoped append to one "global"
 * tenant — was the other candidate and is worse: it would throw away the
 * scoping that makes every guarantee in this file checkable, and one
 * unplaceable user would become indistinguishable from every other.
 *
 * That leaves one question this function actually has to answer — which
 * INSTANCE — and identity history is platform-level rather than any
 * organization's data, so the shared one is where it belongs.
 *
 * This kind arrived unsupported: appends for it threw the refusal below, so
 * no identity event ever reached the log, the fold never ran, and the
 * backfill's parity proof reported `identifier_missing` for every user on
 * every pass. Nothing was corrupted — the guard refused rather than writing
 * somewhere wrong — but nothing could ever finish either.
 *
 * The exception is the case the guard exists for. A user who belongs to a
 * private-dataplane organization is refused, because their identity events
 * would land in the shared platform log while that organization's own data
 * stays on its private instance — which is the same reason
 * `userMigrationPassCohort` already excludes them from the backfill. Re-proved
 * here rather than trusted from the cohort, so the guarantee holds for every
 * caller and not just that one. The check costs nothing when no private
 * instance is configured, which is every installation but ours.
 *
 * An id that names none of the three kinds is still an error rather than the
 * shared client: a tenant we cannot place is exactly the one whose data must
 * not land on somebody else's instance.
 */
export async function getClickHouseClientForTenant(
  tenantId: string,
): Promise<ClickHouseClient | null> {
  if (sharedUserTenantIsFresh(tenantId, Date.now())) {
    return sharedClickHouseClientOrThrow();
  }

  const cached = tenantOrgCache.get(tenantId);
  if (cached) return getClickHouseClientForOrganization(cached);

  const orgId = await organizationIdForTenant(tenantId);
  if (orgId === null) {
    sharedUserTenantCache.set(tenantId, Date.now());
    return sharedClickHouseClientOrThrow();
  }

  tenantOrgCache.set(tenantId, orgId);
  return getClickHouseClientForOrganization(orgId);
}

/**
 * Which organization's instance a tenant belongs to, or `null` when the
 * tenant is a user whose history belongs on the shared instance.
 *
 * The three kinds are asked for in the order they are cheap: a project names
 * its organization in one join, an organization names itself, and only an id
 * that is neither costs the membership check. An id that names none of them
 * throws rather than resolving.
 */
async function organizationIdForTenant(
  tenantId: string,
): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: tenantId },
    select: { team: { select: { organizationId: true } } },
  });
  if (project) return project.team.organizationId;

  const organization = await prisma.organization.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (organization) return organization.id;

  if (await tenantIsUserOnSharedInstance(tenantId)) return null;

  throw new Error(
    `Cannot resolve ClickHouse client: tenant "${tenantId}" is neither a project, an organization, nor a user on the shared instance. Refusing to fall back to shared client to prevent data leakage.`,
  );
}

/**
 * Whether this tenant is a USER whose events belong on the shared instance:
 * the user row exists, and they hold no membership of any organization routed
 * to a private ClickHouse.
 *
 * The membership query is skipped entirely when no private instance is
 * configured, because then there is no other instance for anything to leak
 * onto and the answer cannot be anything but yes.
 */
async function tenantIsUserOnSharedInstance(
  tenantId: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!user) return false;

  const privateOrganizationIds = [...privateClickHouseUrls.keys()];
  if (privateOrganizationIds.length === 0) return true;

  const privateMembership = await prisma.organizationUser.findFirst({
    where: { userId: tenantId, organizationId: { in: privateOrganizationIds } },
    select: { userId: true },
  });
  return privateMembership === null;
}

/** The shared client, or the configuration error that explains its absence. */
function sharedClickHouseClientOrThrow(): ClickHouseClient {
  const shared = _getSharedClickHouseClient();
  if (!shared) {
    throw new Error(
      "ClickHouse is not configured. Set the CLICKHOUSE_URL environment variable. " +
        "See dev/docs/adr/004-docker-dev-environment.md for setup instructions.",
    );
  }
  return shared;
}

/**
 * Returns the appropriate ClickHouse client for a given organization.
 *
 * Checks env vars for a private ClickHouse URL (zero DB query).
 * Falls back to the shared client from CLICKHOUSE_URL.
 */
export async function getClickHouseClientForOrganization(
  organizationId: string,
): Promise<ClickHouseClient> {
  const route = privateClickHouseUrls.get(organizationId);
  if (!route) return sharedClickHouseClientOrThrow();

  return getOrCreateCustomClient(organizationId, route);
}

/**
 * Returns all ClickHouse instances: the shared one plus any private ones from env vars.
 * Useful for migrations, schema checks, or broadcasting DDL to all instances.
 */
export async function getAllClickHouseInstances(): Promise<
  Array<{
    target: "shared" | string;
    client: ClickHouseClient;
  }>
> {
  const instances: Array<{
    target: "shared" | string;
    client: ClickHouseClient;
  }> = [];

  const shared = _getSharedClickHouseClient();
  if (shared) {
    instances.push({ target: "shared", client: shared });
  }

  const seenUrls = new Set<string>();
  for (const [orgId, route] of privateClickHouseUrls) {
    if (seenUrls.has(route.url)) {
      // The cluster name, never the URL: a private ClickHouse URL embeds
      // `user:password@host`, and this line put it in the log sink verbatim.
      logger.info(
        { orgId, cluster: route.cluster },
        "Skipping duplicate private ClickHouse URL (already included for another org)",
      );
      continue;
    }
    seenUrls.add(route.url);
    instances.push({
      target: orgId,
      client: getOrCreateCustomClient(orgId, route),
    });
  }

  return instances;
}

/**
 * Returns whether any ClickHouse instance is configured and available
 * (shared or private). Use for feature-gating (e.g., deciding Real vs Null repository).
 */
export function isClickHouseEnabled(): boolean {
  return (
    _getSharedClickHouseClient() !== null || privateClickHouseUrls.size > 0
  );
}

/**
 * Returns a cached ClickHouse client for the given org and URL,
 * creating one if it doesn't exist yet.
 */
function getOrCreateCustomClient(
  organizationId: string,
  route: PrivateRoute & { url: string },
): ClickHouseClient {
  const cached = customClientCache.get(organizationId);
  if (cached) {
    return cached;
  }

  // Built the same way as the shared client, which it previously was not: it
  // set no pool size at all, so it ran the driver's default of 10, and nothing
  // bounded the statements it would attempt. A private instance is a smaller
  // server than the shared one, so it is the last place that should have had
  // the weaker limits.
  const client = createManagedClickHouseClient({
    url: route.url,
    instance: organizationId,
    cluster: route.cluster,
  });
  customClientCache.set(organizationId, client);
  return client;
}

/**
 * Clears the custom client cache and closes all cached clients.
 * Useful for testing and graceful shutdown.
 */
export async function clearCustomClientCache(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  for (const [organizationId, client] of customClientCache) {
    closePromises.push(client.close());
    // Each private instance registered its limiter under its own org id; drop
    // the probe with the client so the gauges describe only live limiters.
    unregisterClickHouseLimiter(organizationId);
  }
  await Promise.all(closePromises);
  customClientCache.clear();
}

/**
 * Returns the number of cached custom clients.
 * Exposed for testing purposes.
 */
export function getCustomClientCacheSize(): number {
  return customClientCache.size;
}

/**
 * Clears the tenant → org cache. Useful for testing.
 */
export function clearTenantOrgCache(): void {
  tenantOrgCache.clear();
}

/**
 * Returns the parsed private ClickHouse URLs map. Two production consumers on
 * top of the tests: `tasks/clickhouseMigrate.ts` runs each private instance's
 * migrations off the values, and the system-migrations composition reads the
 * KEYS as the private-dataplane organizations a cohort enrollment must skip.
 */
export function getPrivateClickHouseUrls(): ReadonlyMap<string, string> {
  // Projected, not returned directly. The backing map now holds a route object
  // so a failure can name its cluster, but this getter's contract is one URL
  // per org and `tasks/clickhouseMigrate.ts` hands each value straight to goose
  // as a connection string — returning the route would have run every private
  // instance's migrations against "[object Object]".
  return new Map(
    [...privateClickHouseUrls].map(([orgId, route]) => [orgId, route.url]),
  );
}
