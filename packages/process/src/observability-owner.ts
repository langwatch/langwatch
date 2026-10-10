/**
 * Telemetry is an everyone-sends-to-one-place concern, so it declares its
 * config slice and secret handles at its framework owner exactly as a module
 * does (§6). The exporter headers are the shared handle rum also reads.
 */
import {
  Config,
  grafana,
  logSettings,
  otelResourceAttributes,
  parseProcessConfig,
  serviceVersion,
  telemetryExporterEndpoint,
} from "@langwatch/config";
import {
  loggerConfiguration,
  metricsScrapeTokenSecret,
  resolveTelemetry,
  telemetryAliases,
} from "@langwatch/observability/node";
import { telemetryExporterHeaders } from "@langwatch/secrets/shared-secrets";
import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const optionalPort = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().int().min(0).max(65535).optional(),
);
const truthy = z
  .string()
  .optional()
  .transform((value) => value === "true");

/** The old log names the scenario child is handed too, so both hold the same leaf. */
const sharedLogLeaves = new Map(Object.entries(logSettings));

export const observabilityOwner = {
  name: "observability",
  config: Config.define((c) => ({
    otlpEndpoint: telemetryExporterEndpoint,
    environment: c.env("ENVIRONMENT", z.string().min(1).default("local")),
    /** The shared release leaves, so a module reporting its version holds the same instances. */
    serviceVersion,
    resourceAttributes: otelResourceAttributes,
    /** Pyroscope's own push endpoint; absent means the process does not profile. */
    profilingServerAddress: c.env("PYROSCOPE_SERVER_ADDRESS", optionalString),
    /** GRAFANA_* leaves, so every role can link an error to its trace and logs. */
    grafana,
    serviceName: c.env("OTEL_SERVICE_NAME", optionalString),
    sdkDisabled: c.env("OTEL_SDK_DISABLED", truthy),
    tracesSampleRatio: c.env("OTEL_TRACES_SAMPLER_ARG", z.coerce.number().min(0).max(1).optional()),
    /** Standard names (ADR-175); each exporter defaults to `otlp`, behind the one endpoint. */
    traces: { exporter: c.env("OTEL_TRACES_EXPORTER", optionalString) },
    logs: {
      format: logSettings.LOG_FORMAT,
      level: logSettings.LOG_LEVEL,
      consoleLevel: logSettings.LOG_CONSOLE_LEVEL,
      otelLevel: logSettings.LOG_OTEL_LEVEL,
      exporter: c.env("OTEL_LOGS_EXPORTER", optionalString),
    },
    metrics: {
      exporter: c.env("OTEL_METRICS_EXPORTER", optionalString),
      prometheusHost: c.env("OTEL_EXPORTER_PROMETHEUS_HOST", optionalString),
      prometheusPort: c.env("OTEL_EXPORTER_PROMETHEUS_PORT", optionalPort),
    },
    /** main's names, read through `telemetryAliases` with a warning until the LTS floor passes. */
    deprecated: Object.fromEntries(
      telemetryAliases.map(({ deprecated }) => [
        deprecated,
        sharedLogLeaves.get(deprecated) ?? c.env(deprecated, optionalString),
      ]),
    ),
  })),
  secrets: {
    otlpHeaders: telemetryExporterHeaders,
    metricsScrapeToken: metricsScrapeTokenSecret,
  },
} as const;

/**
 * The logger a process that boots no preamble configures from this slice (tasks,
 * the scenario child): the names, aliases and conflict refusal api and worker
 * read. Throws `TelemetryAliasConflictError` when an old name disagrees.
 */
export function processLoggerConfiguration({
  environment,
  serviceName,
}: {
  environment: Readonly<Record<string, string | undefined>>;
  serviceName: string;
}) {
  const settings = parseProcessConfig({ owners: [observabilityOwner], environment }).observability;
  const resolved = resolveTelemetry(settings);
  return {
    configuration: loggerConfiguration({
      settings,
      resolved,
      serviceName: resolved.serviceName ?? serviceName,
    }),
    deprecations: resolved.deprecations,
  };
}
