/**
 * Telemetry is an everyone-sends-to-one-place concern, so it declares its
 * config slice and secret handles at its framework owner exactly as a module
 * does (§6). The handles come from `@langwatch/observability`, which reads them.
 */
import { Config } from "@langwatch/config";
import { metricsScrapeTokenSecret, otlpHeadersSecret } from "@langwatch/observability/node";
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
    otlpEndpoint: c.env("OTEL_EXPORTER_OTLP_ENDPOINT", optionalString),
    /** Browser tracing (ADR-058): on only with an OTLP endpoint to send to. */
    rumEnabled: c.env("RUM_ENABLED", truthy),
    rumSampleRatio: c.env(
      "RUM_SAMPLE_RATIO",
      z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.coerce.number().min(0).max(1).default(1).catch(1),
      ),
    ),
    environment: c.env("ENVIRONMENT", z.string().min(1).default("local")),
    serviceVersion: c.env("SERVICE_VERSION", optionalString),
    resourceAttributes: c.env("OTEL_RESOURCE_ATTRIBUTES", optionalString),
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
    otlpHeaders: otlpHeadersSecret,
    metricsScrapeToken: metricsScrapeTokenSecret,
  },
} as const;
