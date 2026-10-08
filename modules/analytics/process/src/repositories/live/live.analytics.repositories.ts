import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { RateLimiter } from "@langwatch/process-stores";

import type { LwqlProvisioningDatabase } from "../../tasks/lwql-provision.task.ts";
import type { AnalyticsRepositories, LangWatchQlSupply } from "../analytics.repositories.ts";
import { ClickHouseAnalyticsEvaluationRepository } from "../clickhouse/clickhouse.analytics-persistence.repository.ts";
import { ClickHouseAnalyticsRecencyRepository } from "../clickhouse/clickhouse.analytics-recency.repository.ts";
import { ClickHouseAnalyticsSessionsRepository } from "../clickhouse/clickhouse.analytics-sessions.repository.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse/clickhouse.analytics.repository.ts";
import { ClickHouseLangWatchQLAppFunctionStoreRepository } from "../clickhouse/clickhouse.langwatch-ql-app-function-store.repository.ts";
import { TraceAnalyticsClickHouseRepository } from "../clickhouse/clickhouse.trace-analytics-projection.repository.ts";
import { TraceAnalyticsRollupClickHouseRepository } from "../clickhouse/clickhouse.trace-analytics-rollup.repository.ts";
import { RedisAnalyticsRateLimitRepository } from "../redis/redis.analytics-rate-limit.repository.ts";
import { RedisTraceAnalyticsFoldCacheRepository } from "../redis/redis.trace-analytics-fold-cache.repository.ts";

/** Analytics' live stores: rows in ClickHouse, windows and a fold cache in Redis, LWQL targets. */
export class LiveAnalyticsRepositories {
  static readonly requires = [
    "clickhouse",
    "rateLimiter",
    "redis",
    "clickhouseAdmin",
    "databaseTarget",
    "prisma",
  ] as const;

  static create({
    clickhouse,
    rateLimiter,
    redis,
    clickhouseAdmin,
    databaseTarget,
    prisma,
  }: Readonly<{
    clickhouse: ClickHouseQueryClient;
    rateLimiter: RateLimiter;
    redis: Parameters<typeof RedisTraceAnalyticsFoldCacheRepository.create>[0];
    clickhouseAdmin: LangWatchQlSupply["admin"];
    databaseTarget: LangWatchQlSupply["postgres"];
    prisma: LwqlProvisioningDatabase;
  }>): AnalyticsRepositories {
    const sessions = ClickHouseAnalyticsSessionsRepository.create(clickhouse);
    const resolveClient = (tenantId: string) => sessions.resolve(tenantId);
    return {
      sessions,
      analytics: ClickHouseAnalyticsRepository.create({ resolveClient }),
      evaluations: {
        open: ({ defaultRetentionDays }) =>
          ClickHouseAnalyticsEvaluationRepository.create({ resolveClient, defaultRetentionDays }),
      },
      appFunctionStore: ClickHouseLangWatchQLAppFunctionStoreRepository.create(clickhouse),
      recency: ClickHouseAnalyticsRecencyRepository.create(clickhouse),
      rateLimits: RedisAnalyticsRateLimitRepository.create(rateLimiter),
      langWatchQl: { admin: clickhouseAdmin, postgres: databaseTarget, database: () => prisma },
      traceAnalyticsProjection: TraceAnalyticsClickHouseRepository.create({ resolveClient }),
      traceAnalyticsRollup: TraceAnalyticsRollupClickHouseRepository.create({ resolveClient }),
      traceAnalyticsFoldCache: RedisTraceAnalyticsFoldCacheRepository.create(redis),
    };
  }
}
