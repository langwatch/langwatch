import {
  Config,
  environmentBooleanSchema,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import {
  resolveGroupQueuePolicyFromEnv,
  type GroupQueuePolicy,
} from "@langwatch/group-queue";
import { RedisConfigService, type RedisConfigResolution } from "@langwatch/redis-client";
import { z } from "zod";

const DEFAULT_LOCAL_STORAGE_ROOT = "/var/lib/langwatch/objects";
const DEFAULT_PRODUCTION_QUEUE_DRAIN_MS = 25_000;
const DEFAULT_DEVELOPMENT_QUEUE_DRAIN_MS = 5_000;
const APP_CLOSE_SLACK_MS = 5_000;
const PROCESS_CLOSE_SLACK_MS = 15_000;

const optionalEnvironmentString = z.string().optional();

/** Empty credentials mean that the AWS SDK's default provider chain is in use. */
const optionalEnvironmentSecret = optionalEnvironmentString.transform((value) =>
  value?.trim() ? value : undefined,
);

const optionalProxyValue = optionalEnvironmentString.transform((value) => {
  const trimmed = value?.trim();
  return trimmed || undefined;
});

export const workerConfigDefinition = RuntimeConfig.define({
  /** A standalone worker owns background consumer behaviour once installed. */
  processRole: Config.value(z.literal("worker").default("worker"), { env: "WORKER_PROCESS_ROLE" }),
  environment: Config.value(z.string().min(1).default("local"), { env: "ENVIRONMENT" }),
  nodeEnvironment: Config.value(
    z.enum(["development", "test", "production"]).default("development"),
    {
      env: "NODE_ENV",
    },
  ),
  serviceName: Config.value(z.string().min(1).default("langwatch:worker"), {
    env: "WORKER_SERVICE_NAME",
  }),
  serviceVersion: Config.value(z.string().min(1).optional(), {
    env: "SERVICE_VERSION",
  }),
  logger: {
    format: Config.value(z.enum(["pretty", "json"]).optional(), { env: "LOG_FORMAT" }),
    level: Config.value(z.string().min(1).optional(), { env: "LOG_LEVEL" }),
    consoleLevel: Config.value(z.string().min(1).optional(), { env: "LOG_CONSOLE_LEVEL" }),
    otelExportEnabled: Config.value(environmentBooleanSchema.optional(), {
      env: "LOG_OTEL_EXPORT_ENABLED",
    }),
  },
  observability: {
    apiKey: Config.secret({ optional: true, env: "LANGWATCH_API_KEY" }),
    endpoint: Config.url({ optional: true, env: "LANGWATCH_ENDPOINT" }),
    processorType: Config.value(z.enum(["simple", "batch"]).default("batch"), {
      env: "LANGWATCH_PROCESSOR_TYPE",
    }),
  },
  shutdown: {
    queueDrainTimeoutMs: Config.value(optionalEnvironmentString, {
      env: "SHUTDOWN_DRAIN_TIMEOUT_MS",
    }),
  },
  infrastructure: {
    redis: {
      url: Config.value(optionalEnvironmentString, { env: "REDIS_URL" }),
      clusterEndpoints: Config.value(optionalEnvironmentString, {
        env: "REDIS_CLUSTER_ENDPOINTS",
      }),
      dbIndex: Config.value(optionalEnvironmentString, { env: "REDIS_DB_INDEX" }),
    },
    groupQueue: {
      globalConcurrency: Config.value(optionalEnvironmentString, {
        env: "GLOBAL_QUEUE_CONCURRENCY",
      }),
      zstdWritesEnabled: Config.value(optionalEnvironmentString, {
        env: "GROUP_QUEUE_ZSTD_WRITES_ENABLED",
      }),
      msgpackWritesEnabled: Config.value(optionalEnvironmentString, {
        env: "GROUP_QUEUE_MSGPACK_WRITES_ENABLED",
      }),
      tenantConcurrencyCap: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_DISPATCH_TENANT_CAP",
      }),
      globalConcurrencyBudget: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_DISPATCH_GLOBAL_BUDGET",
      }),
    },
    storage: {
      backend: Config.value(z.enum(["s3", "azure"]).optional(), {
        env: "STORED_OBJECTS_BACKEND",
      }),
      localFilesystemRoot: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_LOCAL_STORAGE_PATH",
      }),
      s3: {
        bucket: Config.value(optionalEnvironmentString, { env: "S3_BUCKET_NAME" }),
        endpoint: Config.value(optionalEnvironmentString, { env: "S3_ENDPOINT" }),
        region: Config.value(optionalEnvironmentString, { env: "S3_REGION" }),
        accessKeyId: Config.value(optionalEnvironmentSecret, { env: "S3_ACCESS_KEY_ID" }),
        secretAccessKey: Config.value(optionalEnvironmentSecret, {
          env: "S3_SECRET_ACCESS_KEY",
        }),
        sessionToken: Config.value(optionalEnvironmentSecret, { env: "S3_SESSION_TOKEN" }),
      },
    },
    outboundProxy: {
      https: Config.value(optionalProxyValue, { env: "HTTPS_PROXY" }),
      http: Config.value(optionalProxyValue, { env: "HTTP_PROXY" }),
      noProxy: Config.value(optionalProxyValue, { env: "NO_PROXY" }),
    },
  },
});

type WorkerConfigProjection = ConfigValue<typeof workerConfigDefinition>;

export type WorkerOutboundProxyConfig = Readonly<{
  https?: string;
  http?: string;
  noProxy?: string;
}>;

export type WorkerStorageConfig = Readonly<{
  backend: "azure" | "s3";
  localFilesystemRoot: string;
  s3: Readonly<{
    bucket?: string;
    endpoint?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
  }>;
}>;

export type WorkerInfrastructureConfig = Readonly<{
  redis: RedisConfigResolution;
  groupQueue: GroupQueuePolicy;
  storage: WorkerStorageConfig;
  outboundProxy: WorkerOutboundProxyConfig;
}>;

export type WorkerShutdownConfig = Readonly<{
  processDeadlineMs: number;
}>;

export type WorkerConfig = Readonly<{
  processRole: "worker";
  environment: string;
  nodeEnvironment: "development" | "test" | "production";
  serviceName: string;
  serviceVersion?: string;
  logger: WorkerConfigProjection["logger"];
  observability: WorkerConfigProjection["observability"];
  shutdown: WorkerShutdownConfig;
  infrastructure: WorkerInfrastructureConfig;
}>;

export function resolveWorkerConfig(source: Readonly<Record<string, unknown>>): WorkerConfig {
  const value = RuntimeConfig.create({
    name: "worker",
    definition: workerConfigDefinition,
    source: normalizeWorkerConfigSource(source),
  }).value;

  return {
    processRole: value.processRole,
    environment: value.environment,
    nodeEnvironment: value.nodeEnvironment,
    serviceName: value.serviceName,
    serviceVersion: value.serviceVersion,
    logger: value.logger,
    observability: value.observability,
    shutdown: resolveWorkerShutdownConfig({
      nodeEnvironment: value.nodeEnvironment,
      environment: value.environment,
      queueDrainTimeoutMs: value.shutdown.queueDrainTimeoutMs,
    }),
    infrastructure: {
      redis: new RedisConfigService().resolve(value.infrastructure.redis),
      groupQueue: resolveGroupQueuePolicyFromEnv(value.infrastructure.groupQueue),
      storage: {
        backend: value.infrastructure.storage.backend ?? "s3",
        localFilesystemRoot:
          value.infrastructure.storage.localFilesystemRoot ?? DEFAULT_LOCAL_STORAGE_ROOT,
        s3: {
          ...value.infrastructure.storage.s3,
          region: resolveS3Region(value.infrastructure.storage.s3),
        },
      },
      outboundProxy: value.infrastructure.outboundProxy,
    },
  };
}

function normalizeWorkerConfigSource(
  source: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    ...source,
    WORKER_SERVICE_NAME: source.WORKER_SERVICE_NAME ?? source.OTEL_SERVICE_NAME,
    LOG_LEVEL: source.LOG_LEVEL ?? source.PINO_LOG_LEVEL ?? source._LOG_LEVEL,
    LOG_CONSOLE_LEVEL: source.LOG_CONSOLE_LEVEL ?? source.PINO_CONSOLE_LEVEL,
    LOG_OTEL_EXPORT_ENABLED: source.LOG_OTEL_EXPORT_ENABLED ?? source.PINO_OTEL_ENABLED,
    HTTPS_PROXY: source.HTTPS_PROXY ?? source.https_proxy,
    HTTP_PROXY: source.HTTP_PROXY ?? source.http_proxy,
    NO_PROXY: source.NO_PROXY ?? source.no_proxy,
  };
}

function resolveS3Region(
  s3: WorkerConfigProjection["infrastructure"]["storage"]["s3"],
): string | undefined {
  if (s3.region !== undefined) return s3.region;

  const hasExplicitCredentials = Boolean(s3.accessKeyId && s3.secretAccessKey);
  const isAwsEndpoint = !s3.endpoint || s3.endpoint.endsWith(".amazonaws.com");
  return isAwsEndpoint && !hasExplicitCredentials ? undefined : "auto";
}

function resolveWorkerShutdownConfig(input: {
  nodeEnvironment: WorkerConfigProjection["nodeEnvironment"];
  environment: WorkerConfigProjection["environment"];
  queueDrainTimeoutMs: WorkerConfigProjection["shutdown"]["queueDrainTimeoutMs"];
}): WorkerShutdownConfig {
  const defaultDrainMs =
    input.nodeEnvironment === "development" || input.environment === "local"
      ? DEFAULT_DEVELOPMENT_QUEUE_DRAIN_MS
      : DEFAULT_PRODUCTION_QUEUE_DRAIN_MS;
  const parsed = Number(input.queueDrainTimeoutMs);
  const queueDrainMs = Number.isFinite(parsed) && parsed > 0 ? parsed : defaultDrainMs;
  return { processDeadlineMs: queueDrainMs + APP_CLOSE_SLACK_MS + PROCESS_CLOSE_SLACK_MS };
}
