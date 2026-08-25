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
export type ClickHouseClientResolver = (tenantId: string) => Promise<ClickHouseClient>;

/**
 * Map of orgId → route, parsed from env vars at module load. The format and its
 * parsing live in `./privateRouteKey`.
 *
 * Zero runtime overhead — no DB queries, no decryption.
 */
const privateClickHouseUrls = parsePrivateEnvVars(PRIVATE_CH_ENV_PREFIX, "ClickHouse");

function parsePrivateEnvVars(
  prefix: string,
  label: string,
): Map<string, PrivateRoute & { url: string }> {
  const map = new Map<string, PrivateRoute & { url: string }>();
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix)) continue;

    if (!value || value.trim() === "") {
      logger.warn({ envVar: key }, `Skipping private ${label} env var: empty value`);
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

type CachedPrivateClient = {
  client: ClickHouseClient;
  limiterInstance: string;
};

/** One pool per physical private endpoint, even when several orgs share it. */
const customClientCache = new Map<string, CachedPrivateClient>();

/** Cache of tenantId → organizationId to avoid repeated DB lookups. */
const tenantOrgCache = new Map<string, string>();

/**
 * Returns the appropriate ClickHouse client for a given tenant.
 *
 * A tenant is usually a project, and was only ever a project until the grants
 * ledger (ADR-092 §13) put an aggregate per ORGANIZATION into the same event
 * store. Both kinds resolve here because routing is per-organization either
 * way: a project contributes the organization that owns it, and an
 * organization contributes itself.
 *
 * Resolves that organization (cached), then checks for a private ClickHouse
 * env var for it. Falls back to the shared client.
 *
 * An id that names neither is still an error rather than the shared client:
 * a tenant we cannot place is exactly the one whose data must not land on
 * somebody else's instance.
 */
export async function getClickHouseClientForTenant(
  tenantId: string,
): Promise<ClickHouseClient | null> {
  let orgId = tenantOrgCache.get(tenantId);

  if (!orgId) {
    const project = await prisma.project.findUnique({
      where: { id: tenantId },
      select: { team: { select: { organizationId: true } } },
    });
    orgId = project?.team.organizationId;

    if (!orgId) {
      const organization = await prisma.organization.findUnique({
        where: { id: tenantId },
        select: { id: true },
      });
      if (!organization) {
        throw new Error(
          `Cannot resolve ClickHouse client: tenant "${tenantId}" is neither a project nor an organization. Refusing to fall back to shared client to prevent data leakage.`,
        );
      }
      orgId = organization.id;
    }

    tenantOrgCache.set(tenantId, orgId);
  }

  return getClickHouseClientForOrganization(orgId);
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
  if (!route) {
    const shared = _getSharedClickHouseClient();
    if (!shared) {
      throw new Error(
        "ClickHouse is not configured. Set the CLICKHOUSE_URL environment variable. " +
          "See dev/docs/adr/004-docker-dev-environment.md for setup instructions.",
      );
    }
    return shared;
  }

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
  return _getSharedClickHouseClient() !== null || privateClickHouseUrls.size > 0;
}

/**
 * Returns a cached ClickHouse client for the given physical endpoint,
 * creating one if it doesn't exist yet.
 */
function getOrCreateCustomClient(
  organizationId: string,
  route: PrivateRoute & { url: string },
): ClickHouseClient {
  const cached = customClientCache.get(route.url);
  if (cached) {
    return cached.client;
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
  customClientCache.set(route.url, {
    client,
    limiterInstance: organizationId,
  });
  return client;
}

/**
 * Clears the custom client cache and closes all cached clients.
 * Useful for testing and graceful shutdown.
 */
export async function clearCustomClientCache(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  for (const { client, limiterInstance } of customClientCache.values()) {
    closePromises.push(client.close());
    unregisterClickHouseLimiter(limiterInstance);
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
  return new Map([...privateClickHouseUrls].map(([orgId, route]) => [orgId, route.url]));
}
