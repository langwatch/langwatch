import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

const optionalString = z.string().optional();

// These switches intentionally retain the old instrumentation policy: only
// the literal string "true" enables them. In particular, accepting "1" here
// would turn on the high-volume Redis instrumentation during a config
// migration.
const exactTrue = z
  .string()
  .optional()
  .transform((value) => value === "true");

const telemetryConfigDefinition = RuntimeConfig.define({
  otlpEndpoint: Config.value(optionalString, { env: "OTEL_EXPORTER_OTLP_ENDPOINT" }),
  otlpHeaders: Config.value(optionalString, { env: "OTEL_EXPORTER_OTLP_HEADERS" }),
  otlpTracesHeaders: Config.value(optionalString, {
    env: "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
  }),
  otlpLogsHeaders: Config.value(optionalString, { env: "OTEL_EXPORTER_OTLP_LOGS_HEADERS" }),
  otlpMetricsHeaders: Config.value(optionalString, {
    env: "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
  }),
  langwatchApiKey: Config.value(optionalString, { env: "LANGWATCH_API_KEY" }),
  pinoOtelEnabled: Config.value(exactTrue, { env: "PINO_OTEL_ENABLED" }),
  serviceName: Config.value(optionalString, { env: "OTEL_SERVICE_NAME" }),
  deploymentEnvironment: Config.value(optionalString, { env: "ENVIRONMENT" }),
  resourceAttributes: Config.value(optionalString, { env: "OTEL_RESOURCE_ATTRIBUTES" }),
  tracesSampler: Config.value(optionalString, { env: "OTEL_TRACES_SAMPLER" }),
  tracesSamplerArg: Config.value(optionalString, { env: "OTEL_TRACES_SAMPLER_ARG" }),
  metricsEnabled: Config.value(exactTrue, { env: "OTEL_METRICS_ENABLED" }),
  pyroscopeServerAddress: Config.value(optionalString, {
    env: "PYROSCOPE_SERVER_ADDRESS",
  }),
  nodeEnvironment: Config.value(optionalString, { env: "NODE_ENV" }),
  redisCommandTracingEnabled: Config.value(exactTrue, {
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
 * Resolves the platform's telemetry variables once at the process boundary.
 * Instrumentation receives this semantic value and never reads the process
 * environment itself.
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
    // A trailing slash on the endpoint would produce `//v1/traces`, which some
    // collectors 404 on. Empty strings remain disabled as they were before.
    otlpEndpoint: config.otlpEndpoint?.replace(/\/+$/, "") || void 0,
    otlpHeaders: parseKeyValueList(config.otlpHeaders),
    otlpTracesHeaders: parseKeyValueList(config.otlpTracesHeaders),
    otlpLogsHeaders: parseKeyValueList(config.otlpLogsHeaders),
    otlpMetricsHeaders: parseKeyValueList(config.otlpMetricsHeaders),
    resourceAttributesMap: parseResourceAttributes(config.resourceAttributes),
  };
}

function parseKeyValueList(raw: string | undefined): Record<string, string> {
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

function parseResourceAttributes(raw: string | undefined): Record<string, string> {
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
