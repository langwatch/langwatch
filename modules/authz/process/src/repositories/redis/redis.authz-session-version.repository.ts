import type { ProcessMembers } from "@langwatch/process-stores/members";

import { AuthzSessionVersionRepository } from "../authz-session-version.repository.ts";

const SESSION_VERSION_KEY_PREFIX = "authz:session-version:";

export type AuthzSessionVersionRedis = Pick<ProcessMembers["redis"], "get" | "incr">;

/** Redis-backed session version, one counter per user and never expired. */
export class RedisAuthzSessionVersionRepository extends AuthzSessionVersionRepository {
  static create(options: { redis: AuthzSessionVersionRedis }): RedisAuthzSessionVersionRepository {
    return new RedisAuthzSessionVersionRepository(options.redis);
  }

  private constructor(private readonly redis: AuthzSessionVersionRedis) {
    super();
  }

  async getVersion({ userId }: { userId: string }): Promise<number> {
    const raw = await this.redis.get(`${SESSION_VERSION_KEY_PREFIX}${userId}`);
    if (raw == null) return 0;
    const parsed = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed)) {
      throw new Error(`The session version stored for user ${userId} is not a counter`);
    }
    return parsed;
  }

  // ponytail: one INCR per user; an organization-wide bump on a very large org wants a pipeline.
  async bump({ userIds }: { userIds: readonly string[] }): Promise<void> {
    await Promise.all(
      userIds.map((userId) => this.redis.incr(`${SESSION_VERSION_KEY_PREFIX}${userId}`)),
    );
  }
}
