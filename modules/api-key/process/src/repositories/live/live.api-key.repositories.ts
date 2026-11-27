import type { SharedCredentialRedis } from "@langwatch/redis-client/shared-credential";
import type { SharedCredentialCipher } from "@langwatch/secrets/shared-credential";

import type { ApiKeyRepositories } from "../api-key.repositories.ts";
import { PostgresApiKeyRepositories } from "../prisma/prisma.api-key.repositories.ts";
import {
  PrismaSigningKeyRepository,
  type SigningKeyDatabase,
} from "../prisma/prisma.signing-key.repository.ts";
import {
  RedisApiKeyAnswerCacheRepository,
  type ApiKeyAnswerCacheRedis,
} from "../redis/redis.api-key-answer-cache.repository.ts";
import { RedisApiKeySharedCredentialRepositories } from "../redis/redis.api-key-shared-credential.repositories.ts";
import {
  RedisSigningKeyUsageRepository,
  type SigningKeyUsageRedis,
} from "../redis/redis.signing-key-usage.repository.ts";

/** The Postgres half's own input, so the generated client is named only under `prisma/`. */
type PostgresInput = Parameters<typeof PostgresApiKeyRepositories.create>[0];

/**
 * API-key's live stores: key rows in Postgres; in Redis the token answers every pod shares and
 * the shared sandbox and run tokens, which the process's cipher seals. Signing keys rest in
 * Postgres sealed by the same cipher; their hourly counts live in Redis.
 */
export class LiveApiKeyRepositories {
  static readonly requires = ["prisma", "encryption", "redis"] as const;
  static readonly repositories = {
    ...PostgresApiKeyRepositories.repositories,
    signingKeys: { tables: PrismaSigningKeyRepository.tables },
  };

  static create({
    prisma,
    encryption,
    redis,
  }: {
    prisma: PostgresInput["prisma"] & SigningKeyDatabase;
    encryption: SharedCredentialCipher;
    redis: ApiKeyAnswerCacheRedis & SharedCredentialRedis & SigningKeyUsageRedis;
  }): ApiKeyRepositories {
    return {
      ...PostgresApiKeyRepositories.create({ prisma }),
      answers: RedisApiKeyAnswerCacheRepository.create({ redis }),
      ...RedisApiKeySharedCredentialRepositories.create({ redis, cipher: encryption }),
      signingKeys: PrismaSigningKeyRepository.create({ prisma, cipher: encryption }),
      signingKeyUsage: RedisSigningKeyUsageRepository.create({ redis }),
    };
  }
}
