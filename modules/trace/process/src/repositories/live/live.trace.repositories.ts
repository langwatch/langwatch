import type { ProcessMembers } from "@langwatch/process-stores/members";

import { PostgresTraceRepositories } from "../prisma/prisma.trace.repositories.ts";
import { RedisTraceAnalyticsFoldCacheRepository } from "../redis/redis.trace-analytics-fold-cache.repository.ts";
import { RedisTraceSummaryFoldCacheRepository } from "../redis/redis.trace-summary-fold-cache.repository.ts";
import type { TraceRepositories } from "../trace.repositories.ts";

/** Trace's live stores: corrections in Prisma, rows in ClickHouse, the folds' cache in Redis. */
export class LiveTraceRepositories {
  static readonly requires = ["prisma", "clickhouse", "redis"] as const;

  static create({
    prisma,
    clickhouse,
    redis,
  }: Pick<ProcessMembers, "prisma" | "clickhouse" | "redis">): TraceRepositories {
    return {
      ...PostgresTraceRepositories.create({ prisma, clickhouse }),
      summaryFoldCache: RedisTraceSummaryFoldCacheRepository.create(redis),
      analyticsFoldCache: RedisTraceAnalyticsFoldCacheRepository.create(redis),
    };
  }
}
