import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { RateLimiter } from "@langwatch/process-stores";

import type { LwqlProvisioningDatabase } from "../../tasks/lwql-provision.task.ts";
import type { AnalyticsRepositories, LangWatchQlSupply } from "../analytics.repositories.ts";
import { ClickHouseAnalyticsRecencyRepository } from "../clickhouse/clickhouse.analytics-recency.repository.ts";
import { ClickHouseAnalyticsSessionsRepository } from "../clickhouse/clickhouse.analytics-sessions.repository.ts";
import { ClickHouseLangWatchQLAppFunctionStoreRepository } from "../clickhouse/clickhouse.langwatch-ql-app-function-store.repository.ts";
import { RedisAnalyticsRateLimitRepository } from "../redis/redis.analytics-rate-limit.repository.ts";

/** Analytics' live stores: rows in ClickHouse, windows in Redis, LangWatchQL's server targets. */
export class LiveAnalyticsRepositories {
  static readonly requires = [
    "clickhouse",
    "rateLimiter",
    "clickhouseAdmin",
    "databaseTarget",
    "prisma",
  ] as const;

  static create({
    clickhouse,
    rateLimiter,
    clickhouseAdmin,
    databaseTarget,
    prisma,
  }: Readonly<{
    clickhouse: ClickHouseQueryClient;
    rateLimiter: RateLimiter;
    clickhouseAdmin: LangWatchQlSupply["admin"];
    databaseTarget: LangWatchQlSupply["postgres"];
    prisma: LwqlProvisioningDatabase;
  }>): AnalyticsRepositories {
    return {
      sessions: ClickHouseAnalyticsSessionsRepository.create(clickhouse),
      appFunctionStore: ClickHouseLangWatchQLAppFunctionStoreRepository.create(clickhouse),
      recency: ClickHouseAnalyticsRecencyRepository.create(clickhouse),
      rateLimits: RedisAnalyticsRateLimitRepository.create(rateLimiter),
      langWatchQl: { admin: clickhouseAdmin, postgres: databaseTarget, database: () => prisma },
    };
  }
}
