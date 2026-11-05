import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";
import { z } from "zod";

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
    /** The replicas' cluster, so the credential probe reads on each one (#8858). */
    clickhouseCluster: c.env("CLICKHOUSE_CLUSTER", z.string().optional()),
    /** Members one group project's statement may name; never above the key set's 10,000. */
    aggregateMaxMembers: c.env(
      "LWQL_AGGREGATE_MAX_MEMBERS",
      z.coerce.number().int().positive().max(10_000).optional(),
    ),
  },
  /** Heavy reads one tenant may run at once per process; invalid reads 4 (memory-safety spec). */
  tenantAnalyticsConcurrency: c.env(
    "CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY",
    z.coerce.number().int().positive().catch(4),
  ),
  /** The shared deployment origin a saved chart's platform link is built on. */
  publicBaseUrl,
}));

export type AnalyticsServerConfig = ConfigOf<typeof analyticsServerConfig>;
