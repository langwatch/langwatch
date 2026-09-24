import type { ProcessMembers } from "@langwatch/process-stores/members";

import { ClickHouseEvaluationSession } from "../clickhouse/clickhouse.evaluation-session.store.ts";
import type { EvaluationClickHouseResolver } from "../clickhouse/evaluation-clickhouse-client.ts";
import { ClickHouseEvaluationRepository } from "../clickhouse/evaluation.repository.ts";
import { ClickHouseMonitorPerformanceRepository } from "../clickhouse/monitor-performance.repository.ts";
import type { EvaluationRepositories } from "../evaluation.repositories.ts";
import { PostgresEvaluationRepositories } from "../prisma/prisma.evaluation.repositories.ts";

/** Evaluation's live stores: the cost ledger in Prisma, run history and the trend in ClickHouse. */
export class LiveEvaluationRepositories {
  static readonly requires = ["prisma", "clickhouse"] as const;
  static readonly repositories = PostgresEvaluationRepositories.repositories;

  static create({
    prisma,
    clickhouse,
  }: Pick<ProcessMembers, "prisma" | "clickhouse">): EvaluationRepositories {
    const resolveClient: EvaluationClickHouseResolver = (tenantId) =>
      Promise.resolve(new ClickHouseEvaluationSession(clickhouse, tenantId));

    return {
      ...PostgresEvaluationRepositories.create({ prisma }),
      runs: ClickHouseEvaluationRepository.create({ resolveClient }),
      monitorPerformance: ClickHouseMonitorPerformanceRepository.create({ resolveClient }),
    };
  }
}
