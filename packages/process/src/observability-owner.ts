/**
 * Telemetry is an everyone-sends-to-one-place concern, so it declares its
 * config slice and secret handles at its framework owner exactly as a module
 * does (§6). The exporter headers are the shared handle rum also reads.
 */
import {
  Config,
  otelResourceAttributes,
  serviceVersion,
  telemetryExporterEndpoint,
} from "@langwatch/config";
import { metricsScrapeTokenSecret } from "@langwatch/observability/node";
import { telemetryExporterHeaders } from "@langwatch/secrets/shared-secrets";
import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const truthy = z
  .string()
  .optional()
  .transform((value) => value === "true");

export const observabilityOwner = {
  name: "observability",
  config: Config.define((c) => ({
    otlpEndpoint: telemetryExporterEndpoint,
    environment: c.env("ENVIRONMENT", z.string().min(1).default("local")),
    /** The shared release leaves, so a module reporting its version holds the same instances. */
    serviceVersion,
    resourceAttributes: otelResourceAttributes,
    tracesSampleRatio: c.env("OTEL_TRACES_SAMPLER_ARG", z.coerce.number().min(0).max(1).optional()),
    logs: {
      format: c.env("LOG_FORMAT", z.enum(["pretty", "json"]).optional()),
      level: c.env("PINO_LOG_LEVEL", optionalString),
      consoleLevel: c.env("LOG_CONSOLE_LEVEL", optionalString),
      otelLevel: c.env("LOG_OTEL_LEVEL", optionalString),
      otelExport: c.env("PINO_OTEL_ENABLED", truthy),
    },
    metrics: {
      /**
       * OTLP push is the default: it is cheaper than a scrape at our
       * cardinality, and it is the transport LangWatch production runs on.
       */
      mode: c.env("LANGWATCH_METRICS_MODE", z.enum(["otlp", "prometheus"]).default("otlp")),
      enabled: c.env(
        "OTEL_METRICS_ENABLED",
        z
          .string()
          .optional()
          .transform((value) => value !== "false"),
      ),
    },
  })),
  secrets: {
    otlpHeaders: telemetryExporterHeaders,
    metricsScrapeToken: metricsScrapeTokenSecret,
  },
} as const;
