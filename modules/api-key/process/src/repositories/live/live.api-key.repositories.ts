import type { ApiKeyRepositories } from "../api-key.repositories.ts";
import { PostgresApiKeyRepositories } from "../prisma/prisma.api-key.repositories.ts";
import {
  RedisApiKeyAnswerCacheRepository,
  type ApiKeyAnswerCacheRedis,
} from "../redis/redis.api-key-answer-cache.repository.ts";

/** The Postgres half's own input, so the generated client is named only under `prisma/`. */
type PostgresInput = Parameters<typeof PostgresApiKeyRepositories.create>[0];

/** API-key's live stores: key rows in Postgres, and the token answers every pod shares in Redis. */
export class LiveApiKeyRepositories {
  static readonly requires = ["prisma", "redis"] as const;
  static readonly repositories = PostgresApiKeyRepositories.repositories;

  static create({
    prisma,
    redis,
  }: PostgresInput & { redis: ApiKeyAnswerCacheRedis }): ApiKeyRepositories {
    return {
      ...PostgresApiKeyRepositories.create({ prisma }),
      answers: RedisApiKeyAnswerCacheRepository.create({ redis }),
    };
  }
}
