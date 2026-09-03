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
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  AzureBlobStoredObjectDriver,
  assertTokenModeTransportSafety,
  type AzureCredentials,
  type AzureInjectedIdentity,
  type StoredObjectStorageDriver,
  type StoredObjectsRepository,
} from "@langwatch/stored-object-server";
import { z } from "zod";
import {
  createMigrationStorageEndpoint,
  type MigrationInventory,
  ObjectStorageMigration,
} from "./migrate-object-storage.migration";
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
  s3Driver: StoredObjectStorageDriver;
}): ObjectStorageMigration {
  const endpoints = {
    s3: createMigrationStorageEndpoint({
      provider: "s3",
      driver: s3Driver,
      bucket: config.s3.bucket,
    }),
    azure: createMigrationStorageEndpoint({
      provider: "azure",
      driver: AzureBlobStoredObjectDriver.create(toAzureCredentials(config)),
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

/**
 * The composed entrypoint is absent, and the reason is named.
 *
 * The platform application's runner read `~/env.mjs`, `~/server/db`,
 * `~/server/dataplane-s3` and `~/server/outboundProxy` directly, and none of
 * those exist here. Three of the four have equivalents this process already
 * composes — `WorkerConfig` carries the Redis resolution, the dataplane S3
 * routes and the outbound-proxy policy, and `createWorkerObjectStorage` builds
 * the AWS runtime — but the fourth does not: the migration's inventory reads
 * live stored-object rows out of ClickHouse through `StoredObjectsRepository`,
 * and this process composes no stored-object ClickHouse connection. Only the
 * API does.
 *
 * Recorded rather than defaulted, because the alternative is worse than an
 * absent runner: an inventory built over a connection that resolves the wrong
 * tenant would report a project's objects as already migrated and the finalize
 * phase would flip a cutover over rows it never copied. Everything below the
 * runner takes its collaborators as parameters, so a runner is a few lines the
 * moment a stored-object ClickHouse repository is composable here.
 */
/**
 * The three pages a migration walks: the projects in scope, the live
 * stored-object rows under each, and the datasets whose chunks ride along.
 *
 * `privateOrganizations` is the BYOC exclusion — an organization routed to its
 * own S3 account is not this deployment's to move — and it arrives as the
 * route map the process was configured with rather than being read here.
 */
export function createMigrationInventory({
  repository,
  prisma,
  privateOrganizations,
}: {
  repository: StoredObjectsRepository;
  prisma: Pick<PrismaClient, "project" | "dataset">;
  privateOrganizations: ReadonlyMap<string, unknown>;
}): MigrationInventory {
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

/** The cutover's group-queue check, over the process's own Redis resolution. */
export async function auditQueuesForCutover(config: MigrationCutoverRedisConfig) {
  return MigrationCutoverRedisAudit.create({ config, logger }).audit();
}

/** Runs one phase of the migration. */
export async function runMigrationPhase(
  migration: ObjectStorageMigration,
  phase: MigrationTaskPhase,
) {
  if (phase === "plan") return migration.plan();
  if (phase === "copy") return migration.copy();
  if (phase === "verify") return migration.verify();
  return migration.finalize();
}

export function toAzureCredentials(
  config: MigrationTaskConfig,
  identity?: AzureInjectedIdentity,
): AzureCredentials {
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
    // The migration namespace carries no federated identity of its own: a
    // token-mode run authenticates as whatever the process was injected with,
    // which is what the platform copy did by reading the same three variables
    // off `process.env` inside the token provider.
    identity: identity ?? {},
  };
}
