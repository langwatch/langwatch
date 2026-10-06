import type { AuthzRepositories } from "../authz.repositories.ts";
import { PostgresAuthzRepositories } from "../prisma/prisma.authz.repositories.ts";
import {
  type AuthzEpochRedis,
  RedisAuthzEpochRepository,
} from "../redis/redis.authz-epoch.repository.ts";
import {
  type AuthzSessionVersionRedis,
  RedisAuthzSessionVersionRepository,
} from "../redis/redis.authz-session-version.repository.ts";

/**
 * Authz's live stores: grants facts in Postgres, the permission-cache epoch and the session
 * versions in Redis under their unchanged keys. A process with no Redis refuses at boot naming
 * this module, as it did when the module read Redis itself.
 */
export class LiveAuthzRepositories {
  static readonly requires = ["prisma", "redis"] as const;

  static create({
    prisma,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresAuthzRepositories.create>[0]["prisma"];
    redis: AuthzEpochRedis & AuthzSessionVersionRedis;
  }>): AuthzRepositories {
    return {
      ...PostgresAuthzRepositories.create({ prisma }),
      epoch: RedisAuthzEpochRepository.create({ redis }),
      sessionVersions: RedisAuthzSessionVersionRepository.create({ redis }),
    };
  }
}
