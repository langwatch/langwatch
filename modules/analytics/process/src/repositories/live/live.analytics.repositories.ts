import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { RateLimiter } from "@langwatch/process-stores";

import type { AnalyticsRepositories, LangWatchQlSupply } from "../analytics.repositories.ts";
import { ClickHouseAnalyticsEvaluationRepository } from "../clickhouse/clickhouse.analytics-persistence.repository.ts";
import { ClickHouseAnalyticsRecencyRepository } from "../clickhouse/clickhouse.analytics-recency.repository.ts";
import { ClickHouseAnalyticsSessionsRepository } from "../clickhouse/clickhouse.analytics-sessions.repository.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse/clickhouse.analytics.repository.ts";
import { FilterOptionsClickHouseRepository } from "../clickhouse/clickhouse.filter-options.repository.ts";
import { ClickHouseLangWatchQLAppFunctionStoreRepository } from "../clickhouse/clickhouse.langwatch-ql-app-function-store.repository.ts";
import type { LwqlProvisioningDatabase } from "../langwatch-ql-postgres.repository.ts";
import { RedisAnalyticsRateLimitRepository } from "../redis/redis.analytics-rate-limit.repository.ts";
import {
  type LwqlUnconfirmedSinceRedis,
  RedisLwqlUnconfirmedSinceRepository,
} from "../redis/redis.langwatch-ql-unconfirmed-since.repository.ts";

/** Analytics' live stores: ClickHouse rows, Redis windows and a clock, LangWatchQL's targets. */
export class LiveAnalyticsRepositories {
  static readonly requires = [
    "clickhouse",
    "rateLimiter",
    "clickhouseAdmin",
    "databaseTarget",
    "prisma",
    "redis",
  ] as const;

  static create({
    clickhouse,
    rateLimiter,
    clickhouseAdmin,
    databaseTarget,
    prisma,
    redis,
  }: Readonly<{
    clickhouse: ClickHouseQueryClient;
    rateLimiter: RateLimiter;
    clickhouseAdmin: LangWatchQlSupply["admin"];
    databaseTarget: LangWatchQlSupply["postgres"];
    prisma: LwqlProvisioningDatabase;
    redis: LwqlUnconfirmedSinceRedis;
  }>): AnalyticsRepositories {
    const sessions = ClickHouseAnalyticsSessionsRepository.create(clickhouse);
    const resolveClient = (tenantId: string) => sessions.resolve(tenantId);
    return {
      sessions,
      analytics: ClickHouseAnalyticsRepository.create({ clickhouse }),
      filterOptions: FilterOptionsClickHouseRepository.create({ clickhouse }),
      evaluations: {
        open: ({ defaultRetentionDays }) =>
          ClickHouseAnalyticsEvaluationRepository.create({
            resolveClient,
            defaultRetentionDays,
            clickhouse,
          }),
      },
      appFunctionStore: ClickHouseLangWatchQLAppFunctionStoreRepository.create(clickhouse),
      recency: ClickHouseAnalyticsRecencyRepository.create(clickhouse),
      rateLimits: RedisAnalyticsRateLimitRepository.create(rateLimiter),
      langWatchQl: {
        admin: clickhouseAdmin,
        postgres: databaseTarget,
        database: () => prisma,
        unconfirmedSince: RedisLwqlUnconfirmedSinceRepository.create({ redis }),
      },
    };
  }
}
