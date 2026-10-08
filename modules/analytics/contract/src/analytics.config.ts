import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";
import { z } from "zod";

/** Analytics panel statements one project may run at once in each process, unless overridden. */
export const DEFAULT_TENANT_ANALYTICS_CONCURRENCY = 4;

const blankIsUnset = (value: unknown) => (value === "" ? undefined : value);

/**
 * LangWatchQL's deployment facts (ADR-159). The connection derives from the stores'
 * ClickHouse; these only name the identity and refuse an override that disagrees with it.
 * The passwords are secrets, never config.
 */
export const analyticsServerConfig = Config.define((c) => ({
  langwatchQl: {
    url: c.env("LWQL_CLICKHOUSE_URL", z.string().optional()),
    username: c.env("LWQL_CLICKHOUSE_USER", z.string().optional()),
    database: c.env("LWQL_DATABASE", z.string().optional()),
    tenantSetting: c.env("LWQL_TENANT_SETTING", z.string().optional()),
    postgresHost: c.env("LWQL_POSTGRES_HOST", z.string().optional()),
    accessModelMode: c.env("LWQL_ACCESS_MODEL_MODE", z.string().optional()),
    sqlSingleNode: c.env("LWQL_ACCESS_MODEL_SQL_SINGLE_NODE", z.string().optional()),
  },
  /**
   * Analytics panel statements one project may run at once per process; the rest wait their turn.
   * A positive integer; blank or anything else keeps the default.
   */
  tenantAnalyticsConcurrency: c.env(
    "CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY",
    z.preprocess(
      blankIsUnset,
      z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_TENANT_ANALYTICS_CONCURRENCY)
        .catch(DEFAULT_TENANT_ANALYTICS_CONCURRENCY),
    ),
  ),
  /** The shared deployment origin a saved chart's platform link is built on. */
  publicBaseUrl,
}));

export type AnalyticsServerConfig = ConfigOf<typeof analyticsServerConfig>;
