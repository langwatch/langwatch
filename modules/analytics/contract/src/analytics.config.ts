import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The RESTRICTED ClickHouse identity a member's own SQL runs as.
 *
 * All five leaves are required together and none defaults to the
 * application's own connection: a partial set means the workbench was meant
 * to run, and half of it would either refuse every statement while looking
 * provisioned or run a member's SQL as the full-access identity. Absent
 * altogether is a deployment with no SQL workbench, which is ordinary.
 */
export const analyticsServerConfigDefinition = RuntimeConfig.define({
  langwatchQl: {
    url: Config.value(z.string().optional(), { env: "LWQL_CLICKHOUSE_URL" }),
    username: Config.value(z.string().optional(), { env: "LWQL_CLICKHOUSE_USER" }),
    password: Config.value(z.string().optional(), { env: "LWQL_CLICKHOUSE_PASSWORD" }),
    database: Config.value(z.string().optional(), { env: "LWQL_DATABASE" }),
    tenantSetting: Config.value(z.string().optional(), { env: "LWQL_TENANT_SETTING" }),
  },
});

export type AnalyticsServerConfig = ConfigValue<typeof analyticsServerConfigDefinition>;

/** Named so a partial set can be reported by variable rather than by field. */
export const LANGWATCH_QL_ENV_NAMES = {
  url: "LWQL_CLICKHOUSE_URL",
  username: "LWQL_CLICKHOUSE_USER",
  password: "LWQL_CLICKHOUSE_PASSWORD",
  database: "LWQL_DATABASE",
  tenantSetting: "LWQL_TENANT_SETTING",
} as const;

export const analyticsServerConfigSchema = compileRuntimeConfig(analyticsServerConfigDefinition);

/**
 * Refuses a SQL workbench identity that is half configured, naming the
 * variables the operator still has to set. Variable names only: one of these
 * five is a password.
 *
 * Applied to the RESOLVED value rather than declared as a refinement on the
 * schema, so the rule reads the same shape every process holds.
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
