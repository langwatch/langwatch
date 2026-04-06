/**
 * Managed Bedrock provider routing — resolves per-organization AWS Bedrock
 * credentials from env vars.
 *
 * Env var format:
 *   MANAGED_BEDROCK__<label>__<orgId>={"proxyRoleArn":"...","bedrockRoleArn":"...","proxyAwsAccessKeyId":"...","proxyAwsSecretAccessKey":"...","bedrockProxyEndpoint":"...","region":"us-east-1"}
 *
 * The <label> is a human-readable customer name (e.g., "skai"), ignored by code.
 * The <orgId> is the organization ID used for routing.
 */
import { z } from "zod";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { createLogger } from "~/utils/logger/server";
import { prisma } from "~/server/db";
import type { MaybeStoredModelProvider } from "~/server/modelProviders/registry";

const logger = createLogger("langwatch:managed-providers:bedrock");

const managedBedrockConfigSchema = z.object({
  proxyRoleArn: z.string().min(1),
  bedrockRoleArn: z.string().min(1),
  proxyAwsAccessKeyId: z.string().min(1),
  proxyAwsSecretAccessKey: z.string().min(1),
  bedrockProxyEndpoint: z.string().min(1),
  region: z.string().min(1).default("us-east-1"),
});

export type ManagedBedrockConfig = z.infer<typeof managedBedrockConfigSchema>;

const PRIVATE_BEDROCK_ENV_PREFIX = "MANAGED_BEDROCK__";

/**
 * Map of orgId -> ManagedBedrockConfig, parsed from env vars at module load.
 * Zero runtime overhead — no DB queries.
 */
const managedBedrockConfigs = parseManagedBedrockEnvVars();

function parseManagedBedrockEnvVars(): Map<string, ManagedBedrockConfig> {
  const map = new Map<string, ManagedBedrockConfig>();

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(PRIVATE_BEDROCK_ENV_PREFIX) || !value) {
      continue;
    }

    const suffix = key.slice(PRIVATE_BEDROCK_ENV_PREFIX.length);
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
        "Skipping managed Bedrock config: invalid JSON in env var",
      );
      continue;
    }

    const result = managedBedrockConfigSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn(
        { orgId, envVar: key, errors: result.error.flatten().fieldErrors },
        "Skipping managed Bedrock config: validation failed",
      );
      continue;
    }

    if (map.has(orgId)) {
      throw new Error(
        `Duplicate managed Bedrock config for orgId "${orgId}": env var "${key}" conflicts with an earlier definition.`,
      );
    }

    map.set(orgId, result.data);
    logger.info(
      { orgId, envVar: key },
      "Loaded managed Bedrock config from env var",
    );
  }

  if (map.size > 0) {
    logger.info(
      { count: map.size },
      "Managed Bedrock provider instances configured",
    );
  }

  return map;
}

/** Cache of projectId -> organizationId to avoid repeated DB lookups. */
const projectOrgCache = new Map<string, string>();

export function getManagedBedrockConfigForOrganization(
  orgId: string,
): ManagedBedrockConfig | null {
  return managedBedrockConfigs.get(orgId) ?? null;
}

export async function getManagedBedrockConfigForProject(
  projectId: string,
): Promise<ManagedBedrockConfig | null> {
  const cachedOrgId = projectOrgCache.get(projectId);
  if (cachedOrgId) {
    return getManagedBedrockConfigForOrganization(cachedOrgId);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  const orgId = project?.team.organizationId;
  if (!orgId) return null;

  projectOrgCache.set(projectId, orgId);
  return getManagedBedrockConfigForOrganization(orgId);
}

/**
 * Checks if a provider is managed for a given organization.
 * Currently only supports "bedrock" provider.
 */
export function isManagedProvider(
  orgId: string,
  provider: string,
): boolean {
  if (provider !== "bedrock") return false;
  return managedBedrockConfigs.has(orgId);
}

/**
 * Builds litellm params for a managed Bedrock provider by performing
 * STS credential chaining (proxy role -> customer role).
 */
export async function buildManagedBedrockLitellmParams({
  params,
  projectId,
  modelProvider,
}: {
  params: Record<string, string>;
  projectId: string;
  model: string;
  modelProvider: MaybeStoredModelProvider;
}): Promise<Record<string, string>> {
  const config = await getManagedBedrockConfigForProject(projectId);

  if (!config || modelProvider.provider !== "bedrock") {
    return params;
  }

  const stsClient = new STSClient({
    region: config.region,
    credentials: {
      accessKeyId: config.proxyAwsAccessKeyId,
      secretAccessKey: config.proxyAwsSecretAccessKey,
    },
  });

  const proxyRoleCommand = new AssumeRoleCommand({
    RoleArn: config.proxyRoleArn,
    RoleSessionName: "bedrock-test-python",
  });
  const proxyRoleCredentials = (await stsClient.send(proxyRoleCommand))
    .Credentials;

  if (
    !proxyRoleCredentials?.AccessKeyId ||
    !proxyRoleCredentials?.SecretAccessKey ||
    !proxyRoleCredentials?.SessionToken
  ) {
    throw new Error("Failed to get proxy role credentials");
  }

  const secondStsClient = new STSClient({
    region: config.region,
    credentials: {
      accessKeyId: proxyRoleCredentials.AccessKeyId,
      secretAccessKey: proxyRoleCredentials.SecretAccessKey,
      sessionToken: proxyRoleCredentials.SessionToken,
    },
  });

  const customerCommand = new AssumeRoleCommand({
    RoleArn: config.bedrockRoleArn,
    RoleSessionName: "bedrock-test-python",
  });
  const customerCredentials = (await secondStsClient.send(customerCommand))
    .Credentials;

  if (
    !customerCredentials?.AccessKeyId ||
    !customerCredentials?.SecretAccessKey ||
    !customerCredentials?.SessionToken
  ) {
    throw new Error("Failed to get customer credentials");
  }

  params.aws_access_key_id = customerCredentials.AccessKeyId;
  params.aws_secret_access_key = customerCredentials.SecretAccessKey;
  params.aws_session_token = customerCredentials.SessionToken;
  params.aws_region_name = config.region;
  params.aws_bedrock_runtime_endpoint = `http://${config.bedrockProxyEndpoint}`;

  delete params.api_key;

  return params;
}

/** Clear project-org cache (for testing). */
export function clearProjectOrgCache(): void {
  projectOrgCache.clear();
}
