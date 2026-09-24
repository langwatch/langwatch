import type { ProcessMembers } from "@langwatch/process-stores/members";

import { ClickHouseEvaluationSession } from "../clickhouse/clickhouse.evaluation-session.store.ts";
import type { EvaluationClickHouseResolver } from "../clickhouse/evaluation-clickhouse-client.ts";
import { ClickHouseEvaluationRepository } from "../clickhouse/evaluation.repository.ts";
import { ClickHouseMonitorPerformanceRepository } from "../clickhouse/monitor-performance.repository.ts";
import type { EvaluationRepositories } from "../evaluation.repositories.ts";
import { ObjectStorageEvaluationInputRepository } from "../object-storage/object-storage.evaluation-input.repository.ts";
import { PostgresEvaluationRepositories } from "../prisma/prisma.evaluation.repositories.ts";
import { RedisEvaluationAnalyticsFoldCacheRepository } from "../redis/redis.evaluation-analytics-fold-cache.repository.ts";

/**
 * Evaluation's live stores: the cost ledger in Prisma, run history and the
 * trend in ClickHouse, the analytics fold's cache in Redis, oversized inputs
 * in object storage.
 */
export class LiveEvaluationRepositories {
  static readonly requires = ["prisma", "clickhouse", "redis", "objectStorage"] as const;
  static readonly repositories = PostgresEvaluationRepositories.repositories;

  static create({
    prisma,
    clickhouse,
    redis,
    objectStorage,
  }: Pick<
    ProcessMembers,
    "prisma" | "clickhouse" | "redis" | "objectStorage"
  >): EvaluationRepositories {
    const resolveClient: EvaluationClickHouseResolver = (tenantId) =>
      Promise.resolve(new ClickHouseEvaluationSession(clickhouse, tenantId));

    return {
      ...PostgresEvaluationRepositories.create({ prisma }),
      runs: ClickHouseEvaluationRepository.create({ resolveClient }),
      monitorPerformance: ClickHouseMonitorPerformanceRepository.create({ resolveClient }),
      analyticsFoldCache: RedisEvaluationAnalyticsFoldCacheRepository.create(redis),
      inputs: ObjectStorageEvaluationInputRepository.create({ objectStorage }),
    };
  }
}
