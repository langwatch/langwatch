import type { InstantEvalJudgeRepositories } from "../instant-eval-judge.repositories.ts";
import { PostgresInstantEvalJudgeRepositories } from "../prisma/prisma.instant-eval-judge.repositories.ts";
import {
  type InstantEvalRateLimiterRedis,
  RedisInstantEvalRateLimitRepository,
} from "../redis/redis.instant-eval-rate-limit.repository.ts";

/** The judge's live stores: its three tables in Postgres, the classifier's buckets in Redis. */
export class LiveInstantEvalJudgeRepositories {
  static readonly requires = ["prisma", "redis"] as const;
  static readonly repositories = PostgresInstantEvalJudgeRepositories.repositories;

  static create({
    prisma,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresInstantEvalJudgeRepositories.create>[0]["prisma"];
    redis: InstantEvalRateLimiterRedis;
  }>): InstantEvalJudgeRepositories {
    return {
      ...PostgresInstantEvalJudgeRepositories.create({ prisma }),
      rateLimits: RedisInstantEvalRateLimitRepository.create(redis),
    };
  }
}
