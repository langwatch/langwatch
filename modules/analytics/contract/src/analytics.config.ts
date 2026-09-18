import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * RESTRICTED ClickHouse identity for member SQL workbench—all five leaves
 * required together.
 */
export const analyticsServerConfig = Config.define((c) => ({
  langwatchQl: {
    url: c.env("LWQL_CLICKHOUSE_URL", z.string().optional()),
    username: c.env("LWQL_CLICKHOUSE_USER", z.string().optional()),
    password: c.env("LWQL_CLICKHOUSE_PASSWORD", z.string().optional()),
    database: c.env("LWQL_DATABASE", z.string().optional()),
    tenantSetting: c.env("LWQL_TENANT_SETTING", z.string().optional()),
  },
}));

export type AnalyticsServerConfig = ConfigOf<typeof analyticsServerConfig>;

/** Named so a partial set can be reported by variable rather than by field. */
export const LANGWATCH_QL_ENV_NAMES = {
  url: "LWQL_CLICKHOUSE_URL",
  username: "LWQL_CLICKHOUSE_USER",
  password: "LWQL_CLICKHOUSE_PASSWORD",
  database: "LWQL_DATABASE",
  tenantSetting: "LWQL_TENANT_SETTING",
} as const;

/**
 * Refuses a SQL workbench identity that is half configured, naming only the
 * missing variables (one of the five is a password). Checked against the
 * resolved config, not a schema refinement.
 */
export function assertAnalyticsServerConfig(config: AnalyticsServerConfig): void {
  const absent = Object.entries(LANGWATCH_QL_ENV_NAMES)
    .filter(([field]) => {
      const key = field as keyof AnalyticsServerConfig["langwatchQl"];
      return !config.langwatchQl[key]?.trim();
    })
    .map(([, name]) => name);
  if (absent.length === 0 || absent.length === Object.keys(LANGWATCH_QL_ENV_NAMES).length) return;

  throw new Error(
    `The SQL workbench needs its whole ClickHouse identity: ${absent.join(", ")} ` +
      `${absent.length === 1 ? "is" : "are"} unset. Set the missing values, or remove the rest to ` +
      "run without the workbench.",
  );
}
