import {
  Config,
  environmentBooleanSchema,
  RuntimeConfig,
  portSchema,
  type ConfigValue,
} from "@langwatch/config";
import {
  loggerConfigurationFrom,
  type LoggerConfiguration,
} from "@langwatch/observability";
import type { ProcessObservabilityOptions } from "@langwatch/observability/node";
import {
  resolveGroupQueuePolicyFromEnv,
  type GroupQueuePolicy,
} from "@langwatch/group-queue";
import { RedisConfigService, type RedisConfigResolution } from "@langwatch/redis-client";
import { z } from "zod";

const optionalEnvironmentString = z.string().optional();

/**
 * Telemetry flush and infrastructure release still have to finish after the
 * listener's own drain grace elapses, so the process deadline sits above it.
 */
const PROCESS_CLOSE_SLACK_MS = 15_000;

/**
 * A standalone API bootstrap accepts these deterministic aliases. Existing
 * split-process deployment uses LANGWATCH_API_PORT; API_PORT and PORT are new
 * compatibility inputs for a future physical API executable.
 */
export const API_PORT_ENV_PRECEDENCE = ["API_PORT", "LANGWATCH_API_PORT", "PORT"] as const;

export const apiConfigDefinition = RuntimeConfig.define({
  /** A standalone API owns dispatch-only web behaviour. */
  processRole: Config.value(z.literal("web").default("web"), { env: "API_PROCESS_ROLE" }),
  environment: Config.value(z.string().min(1).default("local"), { env: "ENVIRONMENT" }),
  nodeEnvironment: Config.value(
    z.enum(["development", "test", "production"]).default("development"),
    { env: "NODE_ENV" },
  ),
  serviceName: Config.value(z.string().min(1).default("langwatch-api"), {
    env: "API_SERVICE_NAME",
  }),
  serviceVersion: Config.value(z.string().min(1).optional(), {
    env: "SERVICE_VERSION",
  }),
  host: Config.value(z.string().min(1).default("0.0.0.0"), { env: "API_HOST" }),
  port: Config.value(portSchema.default(5560), { env: "API_PORT" }),
  httpDrainGraceMs: Config.value(z.coerce.number().int().min(0).default(5_000), {
    env: "API_HTTP_DRAIN_GRACE_MS",
  }),
  shutdown: {
    deadlineMs: Config.value(z.coerce.number().int().positive().optional(), {
      env: "API_SHUTDOWN_DEADLINE_MS",
    }),
  },
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
  },
});

type ApiConfigProjection = ConfigValue<typeof apiConfigDefinition>;

export type ApiInfrastructureConfig = Readonly<{
  redis: RedisConfigResolution;
  groupQueue: GroupQueuePolicy;
}>;

export type ApiShutdownConfig = Readonly<{
  /** The whole shutdown sequence's budget, listener drain included. */
  processDeadlineMs: number;
}>;

export type ApiConfig = Readonly<
  Omit<ApiConfigProjection, "infrastructure" | "shutdown"> & {
    infrastructure: ApiInfrastructureConfig;
    shutdown: ApiShutdownConfig;
  }
>;

/** Parses executable configuration once, before API services are composed. */
export function resolveApiConfig(source: Readonly<Record<string, unknown>>): ApiConfig {
  const value = RuntimeConfig.create({
    name: "api",
    definition: apiConfigDefinition,
    source: {
      ...source,
      API_PORT: firstDefined(source, API_PORT_ENV_PRECEDENCE),
    },
  }).value;
  return {
    ...value,
    shutdown: {
      processDeadlineMs:
        value.shutdown.deadlineMs ?? value.httpDrainGraceMs + PROCESS_CLOSE_SLACK_MS,
    },
    infrastructure: {
      redis: new RedisConfigService().resolve(value.infrastructure.redis),
      groupQueue: resolveGroupQueuePolicyFromEnv(value.infrastructure.groupQueue),
    },
  };
}

/**
 * The logger receives semantic process values, never a raw environment source.
 *
 * Delegates to `loggerConfigurationFrom` in `@langwatch/observability`: every
 * process (api, worker, and any future one) folds its parsed config through
 * the same one-place mapping, so a new logger field lands in one map instead
 * of drifting across N copies.
 */
export function apiLoggerConfiguration(config: ApiConfig): LoggerConfiguration {
  return loggerConfigurationFrom(config);
}

/** Builds SDK setup from parsed semantic configuration before boot side effects. */
export function apiObservabilityConfiguration(config: ApiConfig): ProcessObservabilityOptions {
  const langwatch = config.observability.apiKey
    ? {
        apiKey: config.observability.apiKey,
        endpoint: config.observability.endpoint,
        processorType: config.observability.processorType,
      }
    : ("disabled" as const);

  return {
    serviceName: config.serviceName,
    loggerName: config.serviceName,
    setup: {
      langwatch,
      attributes: {
        "deployment.environment.name": config.environment,
        ...(config.serviceVersion ? { "service.version": config.serviceVersion } : {}),
      },
    },
  };
}

function firstDefined(
  source: Readonly<Record<string, unknown>>,
  names: readonly string[],
): unknown {
  for (const name of names) {
    const value = source[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

