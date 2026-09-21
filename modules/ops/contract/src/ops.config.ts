import { Config, environmentOneOrTrueSchema, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/** Operator surfaces and config; bearers are optional and blank means the
 * door is not registered. Backup metrics on by default. */
/** Values of `CLICKHOUSE_BACKUP_METRICS_ENABLED` that turn backup collection off. */
const BACKUP_METRICS_OFF_VALUES = new Set(["false", "0", "no", "off"]);

export const opsConfig = Config.define((c) => ({
  /** The ClickHouse EXPLAIN endpoint's operator secret. */
  apiKey: c.env("LANGWATCH_OPS_API_KEY", z.string().optional()),
  /** The metrics-scrape bearer, under the name every LangWatch tier reads it by. */
  metricsApiKey: c.env("METRICS_API_KEY", z.string().optional()),
  /** A third ClickHouse identity; never falls back to the tenant-keyed client. */
  clickhouseOpsUrl: c.env("CLICKHOUSE_OPS_URL", z.string().optional()),
  /**
   * ADR-117 §5: once the connection projection decides sign-in, legacy
   * string writes are refused.
   */
  legacySsoStringWritesRetired: c.env(
    "SSOCONN_ROUTING",
    z
      .string()
      .optional()
      .transform((value) => value === "enforce"),
  ),
  usageStats: {
    disabled: c.env("DISABLE_USAGE_STATS", environmentOneOrTrueSchema),
    installMethod: c.env("INSTALL_METHOD", z.string().optional()),
  },
  collectClickHouseBackupMetrics: c.env(
    "CLICKHOUSE_BACKUP_METRICS_ENABLED",
    z
      .string()
      .optional()
      .transform((value) => !BACKUP_METRICS_OFF_VALUES.has((value ?? "").trim().toLowerCase())),
  ),
  productAnalytics: {
    key: c.env("POSTHOG_KEY", z.string().optional()),
    host: c.env("POSTHOG_HOST", z.string().optional()),
  },
}));

export type OpsServerConfig = ConfigOf<typeof opsConfig>;

/** What a browser is told about product analytics and browser tracing. */
export const opsWebConfigSchema = z.strictObject({
  browserTracing: z.boolean(),
  sampleRatio: z.number().min(0).max(1),
  posthog: z
    .strictObject({ key: z.string().min(1), host: z.string().min(1).optional() })
    .optional(),
});

export type OpsWebConfig = z.infer<typeof opsWebConfigSchema>;
