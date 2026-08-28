/**
 * Operator task for controlled S3 <-> Azure Blob migration.
 *
 * Usage:
 *   pnpm run task migrateObjectStorage plan
 *   pnpm run task migrateObjectStorage copy
 *   OBJECT_STORAGE_MIGRATION_WRITES_PAUSED=1 \
 *   OBJECT_STORAGE_MIGRATION_READS_PAUSED=1 \
 *     pnpm run task migrateObjectStorage finalize
 *   pnpm run task migrateObjectStorage verify
 *
 * Credentials are read only from the OBJECT_STORAGE_MIGRATION_* namespace.
 * They never need to be placed in command-line arguments or made active app
 * credentials before cutover.
 */
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { getEnvironmentConfig } from "~/env.mjs";
import { AppAwsClientConfiguration } from "~/runtime/app/aws-client.composition";
import { getPrivateS3Configs } from "~/server/dataplane-s3";
import { parseOutboundProxyConfig } from "~/server/outboundProxy";
import { prisma } from "~/server/db";
import { AzureBlobDriver } from "~/server/stored-objects/azure-blob-driver";
import {
  type AzureCredentials,
  assertTokenModeTransportSafety,
} from "~/server/stored-objects/azure-credentials";
import type { StorageDriver } from "~/server/stored-objects/storage-driver";
import { StoredObjectsRepository } from "~/server/stored-objects/stored-objects.repository";
import {
  createMigrationStorageEndpoint,
  type MigrationInventory,
  ObjectStorageMigration,
} from "./objectStorageMigration";
import { MigrationS3StorageDriver } from "./migrate-object-storage.aws.adapter";
import {
  MigrationCutoverRedisAudit,
  type MigrationCutoverRedisConfig,
} from "./migrate-object-storage.redis.adapter";

const logger = createLogger("langwatch:tasks:migrate-object-storage");

const providerSchema = z.enum(["s3", "azure"]);
const authModeSchema = z.enum(["sharedKey", "workloadIdentity", "managedIdentity", "azureCli"]);

const taskConfigSchema = z
  .object({
    sourceProvider: providerSchema,
    targetProvider: providerSchema,
    writesPaused: z.boolean(),
    readsPaused: z.boolean(),
    s3: z.object({
      bucket: z.string().min(1),
      endpoint: z.string().url().optional(),
      region: z.string().min(1).optional(),
      accessKeyId: z.string().min(1).optional(),
      secretAccessKey: z.string().min(1).optional(),
      sessionToken: z.string().min(1).optional(),
    }),
    azure: z.object({
      accountName: z.string().min(1),
      container: z.string().min(1),
      accountKey: z.string().min(1).optional(),
      endpoint: z.string().url().optional(),
      authMode: authModeSchema.default("sharedKey"),
      authorityHost: z.string().url().optional(),
      tokenAudience: z.string().url().optional(),
    }),
  })
  .superRefine((value, context) => {
    if (value.sourceProvider === value.targetProvider) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetProvider"],
        message: "source and target providers must differ",
      });
    }
    if ((value.s3.accessKeyId == null) !== (value.s3.secretAccessKey == null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["s3"],
        message: "S3 access key id and secret access key must be provided together",
      });
    }
    if (value.azure.authMode === "sharedKey" && !value.azure.accountKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["azure", "accountKey"],
        message: "Azure sharedKey migration auth requires an account key",
      });
    }
    if (value.azure.authMode !== "sharedKey" && value.azure.accountKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["azure", "accountKey"],
        message: "Azure token migration auth must not include an account key",
      });
    }
  });

export type MigrationTaskConfig = z.infer<typeof taskConfigSchema>;
export type MigrationTaskPhase = "plan" | "copy" | "finalize" | "verify";

export function parseMigrationTaskConfig(source: NodeJS.ProcessEnv): MigrationTaskConfig {
  return taskConfigSchema.parse({
    sourceProvider: source.OBJECT_STORAGE_MIGRATION_SOURCE_PROVIDER,
    targetProvider: source.OBJECT_STORAGE_MIGRATION_TARGET_PROVIDER,
    writesPaused: source.OBJECT_STORAGE_MIGRATION_WRITES_PAUSED === "1",
    readsPaused: source.OBJECT_STORAGE_MIGRATION_READS_PAUSED === "1",
    s3: {
      bucket: source.OBJECT_STORAGE_MIGRATION_S3_BUCKET,
      endpoint: source.OBJECT_STORAGE_MIGRATION_S3_ENDPOINT || undefined,
      region: source.OBJECT_STORAGE_MIGRATION_S3_REGION || undefined,
      accessKeyId: source.OBJECT_STORAGE_MIGRATION_S3_ACCESS_KEY_ID || undefined,
      secretAccessKey: source.OBJECT_STORAGE_MIGRATION_S3_SECRET_ACCESS_KEY || undefined,
      sessionToken: source.OBJECT_STORAGE_MIGRATION_S3_SESSION_TOKEN || undefined,
    },
    azure: {
      accountName: source.OBJECT_STORAGE_MIGRATION_AZURE_ACCOUNT_NAME,
      container: source.OBJECT_STORAGE_MIGRATION_AZURE_CONTAINER,
      accountKey: source.OBJECT_STORAGE_MIGRATION_AZURE_ACCOUNT_KEY || undefined,
      endpoint: source.OBJECT_STORAGE_MIGRATION_AZURE_ENDPOINT || undefined,
      authMode: source.OBJECT_STORAGE_MIGRATION_AZURE_AUTH_MODE || undefined,
      authorityHost: source.OBJECT_STORAGE_MIGRATION_AZURE_AUTHORITY_HOST || undefined,
      tokenAudience: source.OBJECT_STORAGE_MIGRATION_AZURE_TOKEN_AUDIENCE || undefined,
    },
  });
}

export function parseMigrationTaskPhase(value: string | undefined): MigrationTaskPhase {
  if (value === "plan" || value === "copy" || value === "finalize" || value === "verify") {
    return value;
  }
  throw new Error('Migration phase must be one of "plan", "copy", "finalize", or "verify"');
}

export function assertMigrationPhaseMatchesActiveProvider({
  phase,
  config,
  activeEnvironment,
}: {
  phase: MigrationTaskPhase;
  config: MigrationTaskConfig;
  activeEnvironment: NodeJS.ProcessEnv;
}): void {
  const expectedProvider = phase === "verify" ? config.targetProvider : config.sourceProvider;
  const activeProvider = activeEnvironment.STORED_OBJECTS_BACKEND === "azure" ? "azure" : "s3";
  if (activeProvider !== expectedProvider) {
    throw new Error(
      `Migration ${phase} expects ${expectedProvider} to be the active app provider, but ${activeProvider} is active`,
    );
  }

  if (expectedProvider === "s3") {
    assertActiveS3Matches({ phase, config, activeEnvironment });
    return;
  }
  assertActiveAzureMatches({ phase, config, activeEnvironment });
}

function assertActiveS3Matches({
  phase,
  config,
  activeEnvironment,
}: {
  phase: MigrationTaskPhase;
  config: MigrationTaskConfig;
  activeEnvironment: NodeJS.ProcessEnv;
}): void {
  if (activeEnvironment.S3_BUCKET_NAME !== config.s3.bucket) {
    throw new Error(
      `Migration ${phase} expects active S3 bucket "${config.s3.bucket}", but S3_BUCKET_NAME is ${activeEnvironment.S3_BUCKET_NAME ? `"${activeEnvironment.S3_BUCKET_NAME}"` : "unset"}`,
    );
  }
  if (normalizeEndpoint(activeEnvironment.S3_ENDPOINT) !== normalizeEndpoint(config.s3.endpoint)) {
    throw new Error(
      `Migration ${phase} expects the active S3 endpoint to match the migration endpoint`,
    );
  }
}

function assertActiveAzureMatches({
  phase,
  config,
  activeEnvironment,
}: {
  phase: MigrationTaskPhase;
  config: MigrationTaskConfig;
  activeEnvironment: NodeJS.ProcessEnv;
}): void {
  if (
    activeEnvironment.AZURE_BLOB_ACCOUNT_NAME !== config.azure.accountName ||
    activeEnvironment.AZURE_BLOB_CONTAINER !== config.azure.container
  ) {
    throw new Error(
      `Migration ${phase} expects the active Azure account/container to match the migration endpoint`,
    );
  }
  if (
    effectiveAzureEndpoint(config.azure.accountName, activeEnvironment.AZURE_BLOB_ENDPOINT) !==
    effectiveAzureEndpoint(config.azure.accountName, config.azure.endpoint)
  ) {
    throw new Error(
      `Migration ${phase} expects the active Azure endpoint to match the migration endpoint`,
    );
  }
}

function normalizeEndpoint(value: string | undefined): string | undefined {
  return value?.trim().replace(/\/+$/, "") || undefined;
}

function effectiveAzureEndpoint(accountName: string, endpoint: string | undefined): string {
  return normalizeEndpoint(endpoint) ?? `https://${accountName}.blob.core.windows.net`;
}

export function createMigrationTask({
  config,
  inventory,
  publishStoredObject,
  auditQueues,
  s3Driver,
}: {
  config: MigrationTaskConfig;
  inventory: MigrationInventory;
  publishStoredObject: ConstructorParameters<
    typeof ObjectStorageMigration
  >[0]["publishStoredObject"];
  auditQueues: ConstructorParameters<typeof ObjectStorageMigration>[0]["auditQueues"];
  s3Driver: StorageDriver;
}): ObjectStorageMigration {
  const endpoints = {
    s3: createMigrationStorageEndpoint({
      provider: "s3",
      driver: s3Driver,
      bucket: config.s3.bucket,
    }),
    azure: createMigrationStorageEndpoint({
      provider: "azure",
      driver: new AzureBlobDriver(toAzureCredentials(config)),
      accountName: config.azure.accountName,
      container: config.azure.container,
    }),
  };

  return new ObjectStorageMigration({
    source: endpoints[config.sourceProvider],
    destination: endpoints[config.targetProvider],
    inventory,
    publishStoredObject,
    auditQueues,
    writesPaused: () => config.writesPaused,
    readsPaused: () => config.readsPaused,
  });
}

export default async function execute(phaseValue?: string): Promise<void> {
  const phase = parseMigrationTaskPhase(phaseValue);
  const source = process.env;
  const config = parseMigrationTaskConfig(source);
  assertMigrationPhaseMatchesActiveProvider({
    phase,
    config,
    activeEnvironment: source,
  });
  const environment = getEnvironmentConfig();
  const aws = AppAwsClientConfiguration.create(parseOutboundProxyConfig(source));
  const s3Driver = MigrationS3StorageDriver.create({ aws, config: config.s3 });
  const repository = new StoredObjectsRepository();
  let executionFailed = false;
  let firstCloseFailure: unknown;
  try {
    const migration = createMigrationTask({
      config,
      inventory: createMigrationInventory(repository, getPrivateS3Configs()),
      publishStoredObject: (row) => repository.insert({ projectId: row.project_id, row }),
      auditQueues: () =>
        auditQueuesForCutover({
          url: environment.REDIS_URL,
          clusterEndpoints: environment.REDIS_CLUSTER_ENDPOINTS,
          dbIndex: source.REDIS_DB_INDEX,
        }),
      s3Driver,
    });
    const report = await runMigrationPhase(migration, phase);
    logger.info(
      {
        phase,
        report,
        source: config.sourceProvider,
        target: config.targetProvider,
      },
      "Object-storage migration phase completed",
    );
  } catch (error) {
    executionFailed = true;
    throw error;
  } finally {
    try {
      s3Driver.close();
    } catch (error) {
      firstCloseFailure = error;
      logger.error({ error }, "Failed to close object-storage migration S3 client");
    }
    try {
      await aws.close();
    } catch (error) {
      firstCloseFailure ??= error;
      logger.error({ error }, "Failed to close object-storage migration AWS transport");
    }
    if (!executionFailed && firstCloseFailure) {
      throw firstCloseFailure;
    }
  }
}

function createMigrationInventory(
  repository: StoredObjectsRepository,
  privateOrganizations: ReadonlyMap<string, unknown>,
): MigrationInventory {
  return {
    listProjectsPage: async ({ afterId, limit }) => {
      const projects = await prisma.project.findMany({
        where: afterId ? { id: { gt: afterId } } : undefined,
        orderBy: { id: "asc" },
        take: limit,
        select: {
          id: true,
          team: { select: { organizationId: true } },
        },
      });
      return projects.map((project) => ({
        id: project.id,
        privateS3: privateOrganizations.has(project.team.organizationId),
      }));
    },
    listStoredObjectsPage: (projectId, { afterId, limit }) =>
      repository.findLiveRowsByProjectPage({ projectId, afterId, limit }),
    listDatasetsPage: (projectId, { afterId, limit }) =>
      prisma.dataset.findMany({
        // projectId is mandatory here twice over: the multitenancy middleware
        // rejects Dataset queries without it, and the migration's own scope
        // guarantees (BYOC exclusion) rely on only eligible projects being
        // asked for.
        where: { projectId, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: "asc" },
        take: limit,
        select: {
          id: true,
          projectId: true,
          contentLayout: true,
          status: true,
          chunkCount: true,
        },
      }),
  };
}

async function auditQueuesForCutover(config: MigrationCutoverRedisConfig) {
  return MigrationCutoverRedisAudit.create({ config, logger }).audit();
}

async function runMigrationPhase(migration: ObjectStorageMigration, phase: MigrationTaskPhase) {
  if (phase === "plan") return migration.plan();
  if (phase === "copy") return migration.copy();
  if (phase === "verify") return migration.verify();
  return migration.finalize();
}

export function toAzureCredentials(config: MigrationTaskConfig): AzureCredentials {
  const common = {
    accountName: config.azure.accountName,
    endpointBaseUrl: config.azure.endpoint,
  };
  if (config.azure.authMode === "sharedKey") {
    return {
      mode: "sharedKey",
      ...common,
      accountKey: config.azure.accountKey!,
    };
  }
  // The same transport guards the app's own resolver enforces: without them
  // a token-mode migration against an http:// endpoint would put a bearer
  // token on the wire in plaintext, and a sovereign endpoint without an
  // authority host would request tokens from the public-cloud issuer.
  assertTokenModeTransportSafety({
    endpointBaseUrl: config.azure.endpoint,
    authorityHost: config.azure.authorityHost,
  });
  return {
    mode: config.azure.authMode,
    ...common,
    authorityHost: config.azure.authorityHost,
    audience: config.azure.tokenAudience,
  };
}

export { resolveMigrationS3Region } from "./migrate-object-storage.aws.adapter";
export { createCutoverAuditRedis } from "./migrate-object-storage.redis.adapter";
