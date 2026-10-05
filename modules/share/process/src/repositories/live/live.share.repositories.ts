import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import { PostgresShareRepositories } from "../prisma/prisma.share.repositories.ts";
import { RedisShareCacheRepository } from "../redis/redis.share-cache.repository.ts";
import type { ShareRepositories } from "../share.repositories.ts";

/**
 * Share's live stores: links and grants in Postgres, the viewer cache in Redis. A
 * deployment that names no Redis refuses at boot naming this module, rather than
 * serving every viewer check uncached and looking healthy while it does it.
 */
export class LiveShareRepositories {
  static readonly requires = ["prisma", "redis"] as const;

  static create({
    prisma,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresShareRepositories.create>[0]["prisma"];
    redis: IORedis | Cluster;
  }>): ShareRepositories {
    return {
      ...PostgresShareRepositories.create({ prisma }),
      cache: RedisShareCacheRepository.create({ redis }),
    };
  }
}
