import { Config, type ConfigOf } from "@langwatch/config";
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
    accessModelMode: c.env("LWQL_ACCESS_MODEL_MODE", z.string().optional()),
    sqlSingleNode: c.env("LWQL_ACCESS_MODEL_SQL_SINGLE_NODE", z.string().optional()),
  },
}));

export type AnalyticsServerConfig = ConfigOf<typeof analyticsServerConfig>;
