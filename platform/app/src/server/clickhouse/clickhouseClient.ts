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
 * tenant (projectId). Repositories use this instead of holding a fixed client,
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

/** Cache of projectId → organizationId to avoid repeated DB lookups. */
const projectOrgCache = new Map<string, string>();

/**
 * Returns the appropriate ClickHouse client for a given project.
 *
 * Resolves the project's organization (cached), then checks for a private
 * ClickHouse env var for that org. Falls back to the shared client.
 */
export async function getClickHouseClientForProject(
  projectId: string,
): Promise<ClickHouseClient | null> {
  let orgId = projectOrgCache.get(projectId);

  if (!orgId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    if (!project) {
      throw new Error(
        `Cannot resolve ClickHouse client: project "${projectId}" not found. Refusing to fall back to shared client to prevent data leakage.`,
      );
    }
    orgId = project.team.organizationId;
    projectOrgCache.set(projectId, orgId);
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
  return (
    _getSharedClickHouseClient() !== null || privateClickHouseUrls.size > 0
  );
}

/** Re-export for infrastructure-only use (metrics collection, not tenant data). */
export { _getSharedClickHouseClient as getSharedClickHouseClient } from "./client";

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
 * Clears the project → org cache. Useful for testing.
 */
export function clearProjectOrgCache(): void {
  projectOrgCache.clear();
}

/**
 * Returns the parsed private ClickHouse URLs map. Exposed for testing.
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
