import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createResilientClickHouseClient } from "~/server/app-layer/clients/clickhouse.resilient";
import { createLogger } from "~/utils/logger/server";
import { prisma } from "../db";
import { _getSharedClickHouseClient } from "./client";
import { wrapWithDefaultSettings } from "./safeClickhouseClient";

const logger = createLogger("langwatch:clickhouse:routing");

/**
 * Resolver function that returns the appropriate ClickHouseClient for a given
 * tenant (projectId). Repositories use this instead of holding a fixed client,
 * enabling per-tenant routing to private ClickHouse instances.
 */
export type ClickHouseClientResolver = (tenantId: string) => Promise<ClickHouseClient>;

/**
 * Env var format: CLICKHOUSE_URL__<label>__<orgId>=<connectionUrl>
 *
 * The <label> is a human-readable customer name (e.g., "acme"), ignored by code.
 * The <orgId> is the organization ID used for routing.
 *
 * Example:
 *   CLICKHOUSE_URL__acme__dv0uZFgPfenFvzg2qKNQa=http://default:pass@acme-ch:8123/langwatch
 */
const PRIVATE_CH_ENV_PREFIX = "CLICKHOUSE_URL__";

/**
 * Map of orgId → connectionUrl, parsed from env vars at module load.
 * Zero runtime overhead — no DB queries, no decryption.
 */
const privateClickHouseUrls = parsePrivateEnvVars(PRIVATE_CH_ENV_PREFIX, "ClickHouse");

function parsePrivateEnvVars(prefix: string, label: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix)) continue;

    if (!value || value.trim() === "") {
      logger.warn({ envVar: key }, `Skipping private ${label} env var: empty value`);
      continue;
    }

    // Format: <PREFIX><label>__<orgId>
    // Strip prefix, then take the last segment after "__" as orgId
    const suffix = key.slice(prefix.length);
    const lastSep = suffix.lastIndexOf("__");
    const orgId = lastSep >= 0 ? suffix.slice(lastSep + 2) : suffix;

    if (!orgId) continue;

    if (map.has(orgId)) {
      throw new Error(
        `Duplicate private ${label} config for orgId "${orgId}": env var "${key}" conflicts with an earlier definition.`,
      );
    }

    map.set(orgId, value);
    logger.info({ orgId, envVar: key }, `Loaded private ${label} URL from env var`);
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
): Promise<ClickHouseClient | null> {
  const privateUrl = privateClickHouseUrls.get(organizationId);
  if (!privateUrl) {
    return _getSharedClickHouseClient();
  }

  return getOrCreateCustomClient(organizationId, privateUrl);
}

/**
 * Returns all ClickHouse instances: the shared one plus any private ones from env vars.
 * Useful for migrations, schema checks, or broadcasting DDL to all instances.
 */
export async function getAllClickHouseInstances(): Promise<Array<{
  target: "shared" | string;
  client: ClickHouseClient;
}>> {
  const instances: Array<{ target: "shared" | string; client: ClickHouseClient }> = [];

  const shared = _getSharedClickHouseClient();
  if (shared) {
    instances.push({ target: "shared", client: shared });
  }

  const seenUrls = new Set<string>();
  for (const [orgId, url] of privateClickHouseUrls) {
    if (seenUrls.has(url)) {
      logger.info(
        { orgId, url },
        "Skipping duplicate private ClickHouse URL (already included for another org)",
      );
      continue;
    }
    seenUrls.add(url);
    instances.push({
      target: orgId,
      client: getOrCreateCustomClient(orgId, url),
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

/** Re-export for infrastructure-only use (metrics collection, not tenant data). */
export { _getSharedClickHouseClient as getSharedClickHouseClient } from "./client";


/**
 * Returns a cached ClickHouse client for the given org and URL,
 * creating one if it doesn't exist yet.
 */
function getOrCreateCustomClient(
  organizationId: string,
  url: string,
): ClickHouseClient {
  const cached = customClientCache.get(organizationId);
  if (cached) {
    return cached;
  }

  let parsedUrl: URL | string = url;
  try {
    parsedUrl = new URL(url);
  } catch {
    // If not a valid URL, pass raw — ClickHouse client may still accept it
  }

  const raw = createClient({
    url: parsedUrl,
    clickhouse_settings: {
      date_time_input_format: "best_effort",
    },
  });

  const client = wrapWithDefaultSettings(
    createResilientClickHouseClient({ client: raw }),
  );
  customClientCache.set(organizationId, client);
  return client;
}

/**
 * Clears the custom client cache and closes all cached clients.
 * Useful for testing and graceful shutdown.
 */
export async function clearCustomClientCache(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  for (const client of customClientCache.values()) {
    closePromises.push(client.close());
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
  return privateClickHouseUrls;
}
