import {
  Config,
  compileRuntimeConfig,
  environmentOneOrTrueSchema,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { z } from "zod";

/**
 * The operator surfaces: the two bearers that gate them, the second
 * ClickHouse identity a cross-tenant EXPLAIN runs as, and what this install
 * reports about itself.
 *
 * Every bearer is optional and blank means the door is not registered at all,
 * so no caller can reach an operator surface by presenting nothing.
 * `collectClickHouseBackupMetrics` is on unless deliberately turned off,
 * which is why it is a switch with a `true` default rather than an opt-in.
 */
/** Values of `CLICKHOUSE_BACKUP_METRICS_ENABLED` that turn backup collection off. */
const BACKUP_METRICS_OFF_VALUES = new Set(["false", "0", "no", "off"]);

export const opsServerConfigDefinition = RuntimeConfig.define({
  /** The ClickHouse EXPLAIN endpoint's operator secret. */
  apiKey: Config.value(z.string().optional(), { env: "LANGWATCH_OPS_API_KEY" }),
  /** The metrics-scrape bearer, under the name every LangWatch tier reads it by. */
  metricsApiKey: Config.value(z.string().optional(), { env: "METRICS_API_KEY" }),
  /** A third ClickHouse identity; never falls back to the tenant-keyed client. */
  clickhouseOpsUrl: Config.value(z.string().optional(), { env: "CLICKHOUSE_OPS_URL" }),
  usageStats: {
    disabled: Config.value(environmentOneOrTrueSchema, { env: "DISABLE_USAGE_STATS" }),
    installMethod: Config.value(z.string().optional(), { env: "INSTALL_METHOD" }),
  },
  collectClickHouseBackupMetrics: Config.value(
    z
      .string()
      .optional()
      .transform((value) => !BACKUP_METRICS_OFF_VALUES.has((value ?? "").trim().toLowerCase())),
    { env: "CLICKHOUSE_BACKUP_METRICS_ENABLED" },
  ),
  productAnalytics: {
    key: Config.value(z.string().optional(), { env: "POSTHOG_KEY" }),
    host: Config.value(z.string().optional(), { env: "POSTHOG_HOST" }),
  },
});

export type OpsServerConfig = ConfigValue<typeof opsServerConfigDefinition>;

export const opsServerConfigSchema = compileRuntimeConfig(opsServerConfigDefinition);

/** What a browser is told about product analytics and browser tracing. */
export const opsWebConfigSchema = z.strictObject({
  browserTracing: z.boolean(),
  sampleRatio: z.number().min(0).max(1),
  posthog: z
    .strictObject({ key: z.string().min(1), host: z.string().min(1).optional() })
    .optional(),
});

export type OpsWebConfig = z.infer<typeof opsWebConfigSchema>;
