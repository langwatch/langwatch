import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { decrypt } from "~/utils/encryption";
import { prisma } from "../db";
import { _getSharedClickHouseClient } from "./client";

/**
 * Configuration for a custom ClickHouse instance, stored encrypted
 * as JSON in the Organization.customClickhouse field.
 */
export interface CustomClickhouseConfig {
  url: string;
  user: string;
  password: string;
}

/**
 * Cache of custom ClickHouse clients keyed by organizationId.
 * Prevents creating a new client on every request for the same org.
 */
const customClientCache = new Map<string, ClickHouseClient>();

/**
 * Returns the appropriate ClickHouse client for a given project.
 *
 * Routing logic:
 * 1. Look up the project's organization (project -> team -> organization)
 * 2. If the organization has a customClickhouse config, decrypt it and
 *    create/return a cached client for that org
 * 3. Otherwise, return the default shared client from env vars
 *
 * @param projectId - The project ID to route for
 * @returns A ClickHouseClient for the appropriate instance, or null if
 *          ClickHouse is not configured
 */
export async function getClickHouseClientForProject(
  projectId: string,
): Promise<ClickHouseClient | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: { include: { organization: true } } },
  });

  if (!project) {
    return _getSharedClickHouseClient();
  }

  const organization = project.team.organization;

  if (!organization.customClickhouse) {
    return _getSharedClickHouseClient();
  }

  return getOrCreateCustomClient(
    organization.id,
    organization.customClickhouse,
  );
}

/**
 * Returns the appropriate ClickHouse client for a given organization.
 *
 * Routing logic:
 * 1. Look up the organization's customClickhouse config
 * 2. If configured, decrypt it and create/return a cached client
 * 3. Otherwise, return the default shared client from env vars
 *
 * @param organizationId - The organization ID to route for
 * @returns A ClickHouseClient for the appropriate instance, or null if
 *          ClickHouse is not configured
 */
export async function getClickHouseClientForOrganization(
  organizationId: string,
): Promise<ClickHouseClient | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, customClickhouse: true },
  });

  if (!organization?.customClickhouse) {
    return _getSharedClickHouseClient();
  }

  return getOrCreateCustomClient(organization.id, organization.customClickhouse);
}

/**
 * Returns all ClickHouse instances: the shared one plus any custom org ones.
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

  const orgsWithCustomCH = await prisma.organization.findMany({
    where: { customClickhouse: { not: null } },
    select: { id: true, customClickhouse: true },
  });

  for (const org of orgsWithCustomCH) {
    if (org.customClickhouse) {
      instances.push({
        target: org.id,
        client: getOrCreateCustomClient(org.id, org.customClickhouse),
      });
    }
  }

  return instances;
}

/**
 * Returns whether the shared ClickHouse instance is configured and available.
 * Use for feature-gating (e.g., deciding Real vs Null repository).
 */
export function isClickHouseEnabled(): boolean {
  return _getSharedClickHouseClient() !== null;
}

/**
 * Re-export for infrastructure-only use (metrics collection, not tenant data).
 */
export { _getSharedClickHouseClient as getSharedClickHouseClient } from "./client";

/**
 * Returns a cached custom ClickHouse client for the given organization,
 * creating one if it doesn't exist yet.
 */
function getOrCreateCustomClient(
  organizationId: string,
  encryptedConfig: string,
): ClickHouseClient {
  const cached = customClientCache.get(organizationId);
  if (cached) {
    return cached;
  }

  const decryptedJson = decrypt(encryptedConfig);
  const config: CustomClickhouseConfig = JSON.parse(decryptedJson);

  const client = createClient({
    url: config.url,
    username: config.user,
    password: config.password,
    clickhouse_settings: {
      date_time_input_format: "best_effort",
    },
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
