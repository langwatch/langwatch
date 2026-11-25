import type { RedisConnection } from "@langwatch/redis-client";

import type { InstantEvalClickHouseMember } from "../clickhouse/clickhouse.instant-eval-session.store.ts";
import { ClickHouseInstantEvalRepositories } from "../clickhouse/clickhouse.instant-eval.repositories.ts";
import type { InstantEvalRepositories } from "../instant-eval.repositories.ts";
import { RedisInstantEvalBudgetReservationsRepository } from "../redis/redis.instant-eval-budget-reservations.repository.ts";
import { RedisInstantEvalCancellationRepository } from "../redis/redis.instant-eval-cancellation.repository.ts";

/**
 * The live tier: runs and judgements in the routing ClickHouse; the hints and
 * the holds in Redis, so every pod sees the same ones.
 */
export class LiveInstantEvalRepositories {
  static readonly requires = ["clickhouse", "redis"] as const;

  static create({
    clickhouse,
    redis,
  }: Readonly<{
    clickhouse: InstantEvalClickHouseMember;
    redis: RedisConnection;
  }>): InstantEvalRepositories {
    return {
      ...ClickHouseInstantEvalRepositories.create({ clickhouse }),
      cancellations: RedisInstantEvalCancellationRepository.create(redis),
      budgetReservations: RedisInstantEvalBudgetReservationsRepository.create({ redis }),
    };
  }
}
