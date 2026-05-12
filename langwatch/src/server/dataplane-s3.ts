/**
 * DATAPLANE S3 routing — resolves per-organization S3 configs from env vars.
 *
 * Env var format:
 *   DATAPLANE_S3__<label>__<orgId>={"endpoint":"...","bucket":"...","accessKeyId":"...","secretAccessKey":"..."}
 *
 * The <label> is a human-readable customer name (e.g., "acme"), ignored by code.
 * The <orgId> is the organization ID used for routing.
 *
 * When no private config exists for an organization, callers fall back to the
 * shared S3 env vars (S3_ENDPOINT, S3_BUCKET_NAME, etc.).
 */
import { z } from "zod";
import { createLogger } from "~/utils/logger/server";
import { prisma } from "./db";

const logger = createLogger("langwatch:dataplane:s3");

const dataplaneS3ConfigSchema = z.object({
  endpoint: z.string().min(1, "endpoint must not be empty"),
  bucket: z.string().min(1, "bucket must not be empty"),
  accessKeyId: z.string().min(1, "accessKeyId must not be empty"),
  secretAccessKey: z.string().min(1, "secretAccessKey must not be empty"),
});

/** Configuration for a private S3 dataplane bucket. */
export type DataplaneS3Config = z.infer<typeof dataplaneS3ConfigSchema>;

const PRIVATE_S3_ENV_PREFIX = "DATAPLANE_S3__";

/**
 * Map of orgId -> DataplaneS3Config, parsed from env vars at module load.
 * Zero runtime overhead — no DB queries, no decryption.
 */
const privateS3Configs = parsePrivateS3EnvVars();

function parsePrivateS3EnvVars(): Map<string, DataplaneS3Config> {
  const map = new Map<string, DataplaneS3Config>();

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(PRIVATE_S3_ENV_PREFIX) || !value) {
      continue;
    }

    // Format: DATAPLANE_S3__<label>__<orgId>
    // Strip prefix, then take the last segment after "__" as orgId
    const suffix = key.slice(PRIVATE_S3_ENV_PREFIX.length);
    const lastSep = suffix.lastIndexOf("__");
    const orgId = lastSep >= 0 ? suffix.slice(lastSep + 2) : suffix;
    if (!orgId) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      logger.warn(
        { orgId, envVar: key },
        "Skipping private S3 config: invalid JSON in env var",
      );
      continue;
    }

    const result = dataplaneS3ConfigSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn(
        { orgId, envVar: key, errors: result.error.flatten().fieldErrors },
        "Skipping private S3 config: validation failed",
      );
      continue;
    }

    if (map.has(orgId)) {
      throw new Error(
        `Duplicate private S3 config for orgId "${orgId}": env var "${key}" conflicts with an earlier definition. Each orgId must map to exactly one S3 config.`,
      );
    }

    map.set(orgId, result.data);
    logger.info(
      { orgId, envVar: key },
      "Loaded private S3 config from env var",
    );
  }

  if (map.size > 0) {
    logger.info(
      { count: map.size },
      "Private S3 dataplane instances configured",
    );
  }

  return map;
}

/** Cache of projectId -> organizationId to avoid repeated DB lookups. */
const projectOrgCache = new Map<string, string>();

/**
 * Returns the private S3 config for an organization, or null if the org
 * uses the shared S3 (caller falls back to shared env vars).
 */
export function getS3ConfigForOrganization(
  organizationId: string,
): DataplaneS3Config | null {
  return privateS3Configs.get(organizationId) ?? null;
}

/**
 * Returns the private S3 config for a project's organization, or null if
 * the org uses the shared S3. Caches the projectId -> orgId mapping.
 */
export async function getS3ConfigForProject(
  projectId: string,
): Promise<DataplaneS3Config | null> {
  let orgId = projectOrgCache.get(projectId);

  if (!orgId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });

    if (!project) {
      return null;
    }

    orgId = project.team.organizationId;
    projectOrgCache.set(projectId, orgId);
  }

  return getS3ConfigForOrganization(orgId);
}

/**
 * Clears the project -> org cache. Useful for testing.
 */
export function clearS3ProjectOrgCache(): void {
  projectOrgCache.clear();
}

/**
 * Returns the parsed private S3 configs map. Exposed for testing.
 */
export function getPrivateS3Configs(): ReadonlyMap<
  string,
  DataplaneS3Config
> {
  return privateS3Configs;
}
