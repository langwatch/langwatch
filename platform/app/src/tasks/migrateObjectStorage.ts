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
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createLogger } from "@langwatch/observability";
import { RedisConnectionService } from "@langwatch/redis-client";
import { Cluster } from "ioredis";
import { z } from "zod";
import { env } from "~/env.mjs";
import { getPrivateS3Configs } from "~/server/dataplane-s3";
import { prisma } from "~/server/db";
import { AzureBlobDriver } from "~/server/stored-objects/azure-blob-driver";
import {
  type AzureCredentials,
  assertTokenModeTransportSafety,
} from "~/server/stored-objects/azure-credentials";
import { ObjectNotFoundError } from "~/server/stored-objects/errors";
import type { StorageDriver } from "~/server/stored-objects/storage-driver";
import { StoredObjectsRepository } from "~/server/stored-objects/stored-objects.repository";
import {
  auditGroupQueuesForStorageMigration,
  type QueueAuditRedis,
} from "./groupQueueMigrationAudit";
import {
  createMigrationStorageEndpoint,
  type MigrationInventory,
  ObjectStorageMigration,
} from "./objectStorageMigration";

const logger = createLogger("langwatch:tasks:migrate-object-storage");

const providerSchema = z.enum(["s3", "azure"]);
const authModeSchema = z.enum([
  "sharedKey",
  "workloadIdentity",
  "managedIdentity",
  "azureCli",
]);

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
  if (
    value === "plan" ||
    value === "copy" ||
    value === "finalize" ||
    value === "verify"
  ) {
    return value;
  }
  throw new Error(
    'Migration phase must be one of "plan", "copy", "finalize", or "verify"',
  );
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
  const expectedProvider =
    phase === "verify" ? config.targetProvider : config.sourceProvider;
  const activeProvider =
    activeEnvironment.STORED_OBJECTS_BACKEND === "azure" ? "azure" : "s3";
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
  if (
    normalizeEndpoint(activeEnvironment.S3_ENDPOINT) !==
    normalizeEndpoint(config.s3.endpoint)
  ) {
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
    effectiveAzureEndpoint(
      config.azure.accountName,
      activeEnvironment.AZURE_BLOB_ENDPOINT,
    ) !== effectiveAzureEndpoint(config.azure.accountName, config.azure.endpoint)
  ) {
    throw new Error(
      `Migration ${phase} expects the active Azure endpoint to match the migration endpoint`,
    );
  }
}

function normalizeEndpoint(value: string | undefined): string | undefined {
  return value?.trim().replace(/\/+$/, "") || undefined;
}

function effectiveAzureEndpoint(
  accountName: string,
  endpoint: string | undefined,
): string {
  return normalizeEndpoint(endpoint) ?? `https://${accountName}.blob.core.windows.net`;
}

export function createMigrationTask({
  config,
  inventory,
  publishStoredObject,
  auditQueues,
}: {
  config: MigrationTaskConfig;
  inventory: MigrationInventory;
  publishStoredObject: ConstructorParameters<
    typeof ObjectStorageMigration
  >[0]["publishStoredObject"];
  auditQueues: ConstructorParameters<typeof ObjectStorageMigration>[0]["auditQueues"];
}): ObjectStorageMigration {
  const endpoints = {
    s3: createMigrationStorageEndpoint({
      provider: "s3",
      driver: new ExplicitS3Driver(config.s3),
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
  const config = parseMigrationTaskConfig(process.env);
  assertMigrationPhaseMatchesActiveProvider({
    phase,
    config,
    activeEnvironment: process.env,
  });
  const repository = new StoredObjectsRepository();
  const migration = createMigrationTask({
    config,
    inventory: createMigrationInventory(repository, getPrivateS3Configs()),
    publishStoredObject: (row) => repository.insert({ projectId: row.project_id, row }),
    auditQueues: auditQueuesForCutover,
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

async function auditQueuesForCutover() {
  // `task.ts` boots no App, so this task owns the connection it needs and
  // closes it below (ADR-093). It used to read the `~/server/redis` module
  // singleton, which no longer exists.
  const connection = new RedisConnectionService({ logger }).connect({
    url: env.REDIS_URL,
    clusterEndpoints: env.REDIS_CLUSTER_ENDPOINTS,
    dbIndex: env.REDIS_DB_INDEX,
  });
  if (!connection) {
    throw new Error(
      "Redis is required to audit GroupQueue before migration finalization",
    );
  }
  const { redis, scanNodes, cleanup } = await createCutoverAuditRedis(connection);
  try {
    return await auditGroupQueuesForStorageMigration(redis, Date.now(), scanNodes);
  } finally {
    cleanup();
    connection.disconnect();
  }
}

/**
 * The app's shared cluster client runs `scaleReads: "all"`, so its read
 * commands (GET/SMEMBERS/ZCOUNT/ZCARD/SCARD/HVALS) may be served by a
 * lagging replica. A stale replica can under-count pending work or miss a
 * staged durable reference, hand finalization a false clean audit, and
 * strand that payload after cutover. The audit therefore reads through a
 * master-only duplicate of the connection; single-node Redis has no
 * replicas to mis-route to and is used as-is.
 */
export async function createCutoverAuditRedis(sharedConnection: unknown): Promise<{
  redis: QueueAuditRedis;
  scanNodes: QueueAuditRedis[];
  cleanup: () => void;
}> {
  if (!(sharedConnection instanceof Cluster)) {
    const redis = sharedConnection as QueueAuditRedis;
    return { redis, scanNodes: [redis], cleanup: () => void 0 };
  }
  const masterOnly = sharedConnection.duplicate([], {
    scaleReads: "master",
  });
  // nodes() reflects discovered topology, which is empty until the duplicate
  // finishes its own cluster handshake — reading it earlier would hand the
  // audit zero scan targets and silently audit nothing.
  if (masterOnly.status !== "ready") {
    try {
      await waitForClusterReady(masterOnly);
    } catch (error) {
      // Nothing has returned a `cleanup` to the caller yet, so this is the
      // only place the duplicate can be closed. Without it a failed handshake
      // leaves an ioredis Cluster retrying forever behind an error the
      // operator does see — a task that reports a failure and then does not
      // exit.
      masterOnly.disconnect();
      throw error;
    }
  }
  return {
    redis: masterOnly as unknown as QueueAuditRedis,
    scanNodes: masterOnly.nodes("master") as unknown as QueueAuditRedis[],
    cleanup: () => masterOnly.disconnect(),
  };
}

/**
 * ioredis retries a cluster handshake indefinitely and emits no terminal
 * event when every seed node is simply unreachable. Without a bound, a
 * `finalize` run against a wedged Redis waits forever having printed nothing
 * — indistinguishable from a slow audit, and the one phase where an operator
 * is watching with traffic paused. Fail loudly instead.
 */
const CUTOVER_AUDIT_HANDSHAKE_TIMEOUT_MS = 30_000;

function waitForClusterReady(cluster: Cluster): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out after ${CUTOVER_AUDIT_HANDSHAKE_TIMEOUT_MS}ms waiting for the cutover-audit Redis connection to become ready`,
        ),
      );
    }, CUTOVER_AUDIT_HANDSHAKE_TIMEOUT_MS);
    const settle = (error?: Error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    cluster.once("ready", () => settle());
    cluster.once("error", (error: Error) => settle(error));
  });
}

async function runMigrationPhase(
  migration: ObjectStorageMigration,
  phase: MigrationTaskPhase,
) {
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

class ExplicitS3Driver implements StorageDriver {
  private readonly client: S3Client;

  constructor(config: MigrationTaskConfig["s3"]) {
    this.client = new S3Client({
      region: resolveMigrationS3Region(config),
      endpoint: config.endpoint,
      forcePathStyle: !!config.endpoint,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
              sessionToken: config.sessionToken,
            }
          : undefined,
    });
  }

  async get(uri: string): Promise<Readable> {
    const { bucket, key } = parseS3Uri(uri);
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return response.Body as Readable;
    } catch (error) {
      if (isS3Missing(error)) throw new ObjectNotFoundError(uri);
      throw error;
    }
  }

  async put(uri: string, bytes: Buffer, mediaType: string): Promise<void> {
    const { bucket, key } = parseS3Uri(uri);
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: mediaType,
      }),
    );
  }

  async delete(uri: string): Promise<void> {
    const { bucket, key } = parseS3Uri(uri);
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async exists(uri: string): Promise<boolean> {
    const { bucket, key } = parseS3Uri(uri);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error) {
      if (isS3Missing(error)) return false;
      throw error;
    }
  }
}

export function resolveMigrationS3Region(
  config: Pick<MigrationTaskConfig["s3"], "endpoint" | "region">,
): string | undefined {
  // Match the application's production S3 composition: AWS uses the SDK
  // region/provider chain when no region was explicitly supplied, while
  // custom S3 endpoints retain the historical "auto" default.
  return (
    config.region ??
    (config.endpoint && !isAwsS3Endpoint(config.endpoint) ? "auto" : undefined)
  );
}

function isAwsS3Endpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase();
    return (
      hostname === "s3.amazonaws.com" ||
      hostname.endsWith(".amazonaws.com") ||
      hostname.endsWith(".amazonaws.com.cn")
    );
  } catch {
    return false;
  }
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
  const parsed = new URL(uri);
  if (parsed.protocol !== "s3:" || !parsed.hostname || parsed.pathname === "/") {
    throw new Error(`Invalid S3 migration URI: ${uri}`);
  }
  return {
    bucket: parsed.hostname,
    key: parsed.pathname.slice(1),
  };
}

function isS3Missing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    value.name === "NoSuchKey" ||
    value.name === "NotFound" ||
    value.$metadata?.httpStatusCode === 404
  );
}
