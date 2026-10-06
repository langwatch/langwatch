import type { AgentSandboxKeyCipher } from "../agent-sandbox-key.repository.ts";
import type { ApiKeyRepositories } from "../api-key.repositories.ts";
import { PostgresApiKeyRepositories } from "../prisma/prisma.api-key.repositories.ts";
import {
  RedisAgentSandboxKeyRepository,
  type AgentSandboxKeyRedis,
} from "../redis/redis.agent-sandbox-key.repository.ts";
import {
  RedisApiKeyAnswerCacheRepository,
  type ApiKeyAnswerCacheRedis,
} from "../redis/redis.api-key-answer-cache.repository.ts";

/** The Postgres half's own input, so the generated client is named only under `prisma/`. */
type PostgresInput = Parameters<typeof PostgresApiKeyRepositories.create>[0];

/**
 * API-key's live stores: key rows in Postgres; in Redis the token answers every pod shares and
 * the shared sandbox tokens, which the process's cipher seals.
 */
export class LiveApiKeyRepositories {
  static readonly requires = ["prisma", "encryption", "redis"] as const;
  static readonly repositories = PostgresApiKeyRepositories.repositories;

  static create({
    prisma,
    encryption,
    redis,
  }: PostgresInput & {
    encryption: AgentSandboxKeyCipher;
    redis: ApiKeyAnswerCacheRedis & AgentSandboxKeyRedis;
  }): ApiKeyRepositories {
    return {
      ...PostgresApiKeyRepositories.create({ prisma }),
      answers: RedisApiKeyAnswerCacheRepository.create({ redis }),
      sandboxKeys: RedisAgentSandboxKeyRepository.create({ redis, cipher: encryption }),
    };
  }
}
