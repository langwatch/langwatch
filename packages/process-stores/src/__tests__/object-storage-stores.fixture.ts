import { SecretsChain, SecretsResolver } from "@langwatch/secrets";

import { storesOwner, type StoresConfig } from "../config-owner.ts";
import type { ObjectStorageAzureConfig } from "../config.ts";
import { openStores } from "../open-stores.ts";
import { PipelineParticipation } from "../pipeline-selection.ts";

/** Never dialled: destinations are asked for PLATFORM_TENANT_ID, answered with no read. */
const UNREACHED_DATABASE = "postgresql://nobody:nothing@127.0.0.1:9/unreached";

/**
 * The database a placement asks which organization a project is in. Every project is in one
 * organization with no private account, so placement never dials the unreachable database.
 */
export const organizationOfEveryProject = {
  project: { findUnique: () => Promise.resolve({ team: { organizationId: "organization-1" } }) },
  organization: { findUnique: () => Promise.resolve(null) },
  user: { findUnique: () => Promise.resolve(null) },
} as unknown as NonNullable<Parameters<typeof openStores>[0]["members"]>["prisma"];

export type ObjectStorageSettings = StoresConfig["objectStorage"];

export const noObjectStorage: ObjectStorageSettings = {
  backend: undefined,
  localRoot: undefined,
  s3: { bucket: undefined, endpoint: undefined, region: undefined },
  azure: {
    authMode: undefined,
    accountName: undefined,
    container: undefined,
    endpoint: undefined,
    authorityHost: undefined,
    tokenAudience: undefined,
    allowInsecureTokenEndpointForTests: undefined,
    identity: { tenantId: undefined, clientId: undefined, federatedTokenFile: undefined },
  },
};

export const completeAzure: ObjectStorageSettings["azure"] = {
  ...noObjectStorage.azure,
  accountName: "lwacct",
  container: "lw-container",
};

/** The object-storage member a deployment with these settings opens, or what refused it. */
export async function openObjectStorage(options: {
  settings: Partial<ObjectStorageSettings>;
  accountKey?: string;
  environment?: Record<string, string>;
  /** Members the caller supplies; a caller naming its own DATABASE_URL places through that one. */
  members?: Parameters<typeof openStores>[0]["members"];
}) {
  const config: StoresConfig = {
    defaultRetentionDays: 30,
    shutdownDrainTimeoutMs: undefined,
    queueConcurrency: undefined,
    queueTenantCap: undefined,
    queueGlobalBudget: undefined,
    clickhouseStatementLaneReserveShare: undefined,
    clickhousePool: {
      override: undefined,
      replicas: undefined,
      serverMaxConcurrentQueries: undefined,
      serverNodes: undefined,
      clientsPerProcess: undefined,
    },
    rateLimit: { requests: 60, seconds: 60 },
    redis: { dbIndex: undefined },
    objectStorage: { ...noObjectStorage, ...options.settings },
  };
  const environment: Record<string, string> = {
    DATABASE_URL: UNREACHED_DATABASE,
    ...options.environment,
    ...(options.accountKey ? { AZURE_BLOB_ACCOUNT_KEY: options.accountKey } : {}),
  };
  const resolver = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());
  const members =
    options.members ??
    (options.environment?.DATABASE_URL ? undefined : { prisma: organizationOfEveryProject });
  const { members: opened } = await openStores({
    name: "object-storage-test",
    config,
    secrets: resolver.scopeTo(storesOwner.name, Object.values(storesOwner.secrets)),
    pipelines: PipelineParticipation.producer(),
    production: true,
    ...(members ? { members } : {}),
  });
  return {
    storage: opened.read("objectStorage"),
    close: () => opened.close(),
  };
}

/** The Azure block as the member receives it, after the boot seam has read its settings. */
export function azureBlock(
  overrides: Partial<ObjectStorageAzureConfig> = {},
): ObjectStorageAzureConfig {
  return { accountName: "lwacct", container: "lw-container", ...overrides };
}

/** The tenant the directory places without a database read: these suites open no connection. */
export const PLATFORM_TENANT_ID = "platform";
