import { Config, type ConfigOf, telemetryExporterEndpoint } from "@langwatch/config";
import { defineBrowserConfig } from "@langwatch/config/public-app-config";
import { Secret } from "@langwatch/secrets/secret";
import { z } from "zod";

const blankIsUnset = (value: unknown) => (value === "" ? undefined : value);

/**
 * Browser tracing (ADR-058) is on unless `RUM_ENABLED=false`. It exports to rum's collector, else
 * the deprecated `OTEL_EXPORTER_OTLP_*` (warned at boot); with neither the door refuses.
 */
export const rumConfig = Config.define((c) => ({
  enabled: c.env(
    "RUM_ENABLED",
    z
      .string()
      .optional()
      .transform((value) => value !== "false"),
  ),
  sampleRatio: c.env(
    "RUM_SAMPLE_RATIO",
    z.preprocess(blankIsUnset, z.coerce.number().min(0).max(1).default(1).catch(1)),
  ),
  collectorEndpoint: c.env(
    "RUM_COLLECTOR_ENDPOINT",
    z.preprocess(blankIsUnset, z.string().min(1).optional()),
  ),
  telemetryEndpoint: telemetryExporterEndpoint,
}));

export type RumConfig = ConfigOf<typeof rumConfig>;

/** The collector's auth headers, `key=value,key2=value2`: a credential, never a config field. */
export const rumSecrets = {
  collectorHeaders: Secret.load("RUM_COLLECTOR_HEADERS", { optional: true }),
} as const;

/** All a browser learns: whether to trace, and what share of sessions to record. */
export const rumWebConfigSchema = z.strictObject({
  enabled: z.boolean(),
  sampleRatio: z.number().min(0).max(1),
});

export type RumWebConfig = z.infer<typeof rumWebConfigSchema>;

/** Tracing is on unless switched off, and only while a collector would receive it. */
export const rumBrowserConfig = defineBrowserConfig({
  schema: rumWebConfigSchema,
  project: (config: RumConfig) => ({
    enabled: config.enabled && Boolean(config.collectorEndpoint ?? config.telemetryEndpoint),
    sampleRatio: config.sampleRatio,
  }),
});
