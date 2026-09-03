import { z } from "zod";

import { Config, RuntimeConfig, type ConfigValue } from "./runtime-config";

export {
  nodeEnvironmentSchema,
  environmentBooleanSchema,
  environmentPresenceSchema,
  environmentExactOneSchema,
  environmentNotExactOneSchema,
  environmentOneOrTrueSchema,
  environmentLegacyTruthySchema,
  portSchema,
  nonNegativeSecondsSchema,
  type RuntimeConfigIssue,
  InvalidRuntimeConfigError,
  type RuntimeConfigOptions,
  type ConfigLeaf,
  type RuntimeConfigDefinition,
  type ConfigValue,
  RuntimeConfig,
  compileRuntimeConfig,
  Config,
} from "./runtime-config";

export { postgresConfigDefinition } from "./postgres.config";
export { redisConfigDefinition } from "./redis.config";
export { clickhouseConfigDefinition } from "./clickhouse.config";
export { objectStorageConfigDefinition } from "./object-storage.config";
export { mailConfigDefinition } from "./mail.config";
export { groupQueueConfigDefinition } from "./queue.config";
export { egressConfigDefinition } from "./egress.config";
export { observabilityConfigDefinition } from "./observability.config";
export { loggerConfigDefinition } from "./logger.config";
export { authzConfigDefinition } from "./authz.config";
export { runtimeIdentityConfigDefinition } from "./runtime-identity.config";
export { licensingConfigDefinition } from "./licensing.config";
export { githubAppConfigDefinition } from "./github.config";

// These switches intentionally retain the old instrumentation policy: only
// the literal string "true" enables them. In particular, accepting "1" here
// would turn on high-volume Redis instrumentation during a config migration.
const telemetryExactTrue = z
  .string()
  .optional()
  .transform((value) => value === "true");

/** The environment projection consumed by the Node instrumentation adapter. */
export const telemetryConfigDefinition = RuntimeConfig.define({
  otlpEndpoint: Config.value(z.string().optional(), { env: "OTEL_EXPORTER_OTLP_ENDPOINT" }),
  otlpHeaders: Config.value(z.string().optional(), { env: "OTEL_EXPORTER_OTLP_HEADERS" }),
  otlpTracesHeaders: Config.value(z.string().optional(), {
    env: "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
  }),
  otlpLogsHeaders: Config.value(z.string().optional(), { env: "OTEL_EXPORTER_OTLP_LOGS_HEADERS" }),
  otlpMetricsHeaders: Config.value(z.string().optional(), {
    env: "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
  }),
  langwatchApiKey: Config.value(z.string().optional(), { env: "LANGWATCH_API_KEY" }),
  pinoOtelEnabled: Config.value(telemetryExactTrue, { env: "PINO_OTEL_ENABLED" }),
  serviceName: Config.value(z.string().optional(), { env: "OTEL_SERVICE_NAME" }),
  deploymentEnvironment: Config.value(z.string().optional(), { env: "ENVIRONMENT" }),
  resourceAttributes: Config.value(z.string().optional(), { env: "OTEL_RESOURCE_ATTRIBUTES" }),
  tracesSampler: Config.value(z.string().optional(), { env: "OTEL_TRACES_SAMPLER" }),
  tracesSamplerArg: Config.value(z.string().optional(), { env: "OTEL_TRACES_SAMPLER_ARG" }),
  metricsEnabled: Config.value(telemetryExactTrue, { env: "OTEL_METRICS_ENABLED" }),
  pyroscopeServerAddress: Config.value(z.string().optional(), {
    env: "PYROSCOPE_SERVER_ADDRESS",
  }),
  nodeEnvironment: Config.value(z.string().optional(), { env: "NODE_ENV" }),
  redisCommandTracingEnabled: Config.value(telemetryExactTrue, {
    env: "OTEL_TRACE_REDIS_COMMANDS",
  }),
});

type ResolvedTelemetryConfig = ConfigValue<typeof telemetryConfigDefinition>;

export type TelemetryConfig = Omit<
  ResolvedTelemetryConfig,
  "otlpHeaders" | "otlpTracesHeaders" | "otlpLogsHeaders" | "otlpMetricsHeaders"
> & {
  otlpHeaders: Record<string, string>;
  otlpTracesHeaders: Record<string, string>;
  otlpLogsHeaders: Record<string, string>;
  otlpMetricsHeaders: Record<string, string>;
  resourceAttributesMap: Record<string, string>;
};

/**
 * Resolves instrumentation variables once at a process boundary. The
 * instrumentation implementation receives this semantic value and never
 * reads the process environment itself.
 */
export function resolveTelemetryConfiguration(
  source: Readonly<Record<string, unknown>>,
): TelemetryConfig {
  const config = RuntimeConfig.create({
    name: "platform telemetry",
    definition: telemetryConfigDefinition,
    source,
  }).value;

  return {
    ...config,
    // A trailing slash on the endpoint would produce `//v1/traces`, which
    // some collectors 404 on. Empty strings remain disabled as before.
    otlpEndpoint: config.otlpEndpoint?.replace(/\/+$/, "") || void 0,
    otlpHeaders: parseTelemetryKeyValueList(config.otlpHeaders),
    otlpTracesHeaders: parseTelemetryKeyValueList(config.otlpTracesHeaders),
    otlpLogsHeaders: parseTelemetryKeyValueList(config.otlpLogsHeaders),
    otlpMetricsHeaders: parseTelemetryKeyValueList(config.otlpMetricsHeaders),
    resourceAttributesMap: parseTelemetryResourceAttributes(config.resourceAttributes),
  };
}

/** Next invokes the instrumentation hook in both Node and Edge runtimes. */
export function isNodeInstrumentationRuntime(source: Readonly<Record<string, unknown>>): boolean {
  return source.NEXT_RUNTIME === "nodejs";
}

function parseTelemetryKeyValueList(raw: string | undefined): Record<string, string> {
  const values: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;

    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!key || !value) continue;

    try {
      values[decodeURIComponent(key)] = decodeURIComponent(value);
    } catch {
      continue;
    }
  }
  return values;
}

function parseTelemetryResourceAttributes(raw: string | undefined): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pairs = (raw ?? "").split(",").filter((pair) => pair.trim() !== "");

  for (const pair of pairs) {
    const parts = pair.split("=");
    if (parts.length !== 2) return {};

    const rawKey = parts[0];
    const rawValue = parts[1];
    if (rawKey === void 0 || rawValue === void 0) return {};

    const key = rawKey.trim();
    const value = rawValue.trim();
    if (!key) return {};

    try {
      const decodedKey = decodeURIComponent(key);
      const decodedValue = decodeURIComponent(value);
      if (decodedKey.length > 255 || decodedValue.length > 255) return {};
      attributes[decodedKey] = decodedValue;
    } catch {
      return {};
    }
  }

  return attributes;
}

/**
 * Parse an env-string into a positive safe integer, or `undefined` when it
 * isn't one. The result never carries junk: a non-numeric value, `NaN`,
 * `Infinity`, a decimal, zero, or a negative all collapse to `undefined`
 * rather than a value the downstream config would treat as valid.
 */
export function positiveSafeIntegerOrUndefined(raw: string | undefined): number | undefined {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Like {@link positiveSafeIntegerOrUndefined} but accepts `0`. Used for
 * budgets and caps where zero means "unbounded" or "off" and negatives are
 * still nonsense.
 */
export function nonNegativeSafeIntegerOrUndefined(raw: string | undefined): number | undefined {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export {
  DATAPLANE_S3_ENV_PREFIX,
  type DataplaneS3Route,
  type DataplaneS3RoutingTable,
  parseDataplaneS3RoutingTable,
  type SkippedDataplaneS3Route,
} from "./dataplane-s3";
export {
  assertObservabilityDoesNotSelfIngest,
  DEFAULT_LANGWATCH_ENDPOINT,
  type DeploymentAddress,
  type SelfIngestGuardInput,
  SelfIngestingObservabilityError,
} from "./self-ingest-guard";
export {
  getZodIssueMessage,
  mapZodIssuesToLogContext,
  parseZodFieldErrors,
  type ZodErrorStructure,
  type ZodIssue,
} from "./zod-issues";
export { zodErrorMessage } from "./zod-error-message";
