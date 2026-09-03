/**
 * Operator task for controlled S3 <-> Azure Blob migration.
 *
 * Usage:
 *   pnpm --filter @langwatch/tasks task object-storage-migrate plan
 *   pnpm --filter @langwatch/tasks task object-storage-migrate copy
 *   OBJECT_STORAGE_MIGRATION_WRITES_PAUSED=1 \
 *   OBJECT_STORAGE_MIGRATION_READS_PAUSED=1 \
 *     pnpm --filter @langwatch/tasks task object-storage-migrate finalize
 *   pnpm --filter @langwatch/tasks task object-storage-migrate verify
 *
 * Credentials are read only from the OBJECT_STORAGE_MIGRATION_* namespace.
 * They never need to be placed in command-line arguments or made active app
 * credentials before cutover.
 */
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import { AzureBlobStoredObjectDriver } from "#adapters/azure-blob.stored-object-driver.adapter";
import {
  assertTokenModeTransportSafety,
  type AzureCredentials,
  type AzureInjectedIdentity,
} from "#adapters/azure-blob-credentials";
import type { StoredObjectStorageDriver } from "#adapters/stored-object-storage.registry";
import { z } from "zod";
import {
  createMigrationStorageEndpoint,
  type MigrationInventory,
  ObjectStorageMigration,
} from "../services/object-storage-migration.service";
import {
  MigrationCutoverRedisAudit,
  type MigrationCutoverRedisConfig,
} from "../adapters/redis.object-storage-migration.adapter";

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

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * object-storage-migrate <plan|copy|finalize|verify>`. `migration` is a
 * factory rather than a built instance: `apps/tasks` composes every catalogue
 * entry at boot, before a phase is known, so building the
 * {@link ObjectStorageMigration} (via {@link createMigrationTask}) is deferred
 * to `run()`, the same way the process's other infrastructure-backed tasks
 * defer `host.require*()`. This class is only the seam that reads the phase
 * off `args[0]`.
 */
export class ObjectStorageMigrateTask extends Task {
  readonly name = "object-storage-migrate";
  readonly description =
    "Runs one phase (plan, copy, finalize, verify) of an S3 <-> Azure Blob migration.";

  private constructor(private readonly migration: () => ObjectStorageMigration) {
    super();
  }

  static create({
    migration,
  }: {
    migration: () => ObjectStorageMigration;
  }): ObjectStorageMigrateTask {
    return new ObjectStorageMigrateTask(migration);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const phase = parseMigrationTaskPhase(args[0]);
    await runMigrationPhase(this.migration(), phase);
  }
}
