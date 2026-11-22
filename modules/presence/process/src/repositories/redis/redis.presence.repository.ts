import { presenceSessionSchema, type PresenceSession } from "@langwatch/presence-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { nowInstant } from "@langwatch/time";

import { PresenceRepository } from "../presence.repository.ts";

const KEY_PREFIX = "presence:v1";

/**
 * Sessions live at `presence:v1:{<projectId>}:<sessionId>`; each project also keeps a sorted set
 * of its session ids scored by expiry, so listing reads that set instead of scanning the keyspace.
 * Both keys hash on `{<projectId>}`, so a cluster accepts the transactions that write them.
 */
export class RedisPresenceRepository extends PresenceRepository {
  private constructor(
    private readonly redis: RedisConnection,
    private readonly now: () => number,
  ) {
    super();
  }

  static create(
    redis: RedisConnection,
    options: { now?: () => number } = {},
  ): RedisPresenceRepository {
    return new RedisPresenceRepository(
      redis,
      options.now ?? (() => nowInstant().epochMilliseconds),
    );
  }

  async upsert(session: PresenceSession, ttlSeconds: number): Promise<void> {
    const indexKey = this.indexKey(session.projectId);
    // One transaction, so the index never gains an entry without its expiry.
    await this.redis
      .multi()
      .set(
        this.sessionKey(session.projectId, session.sessionId),
        JSON.stringify(session),
        "EX",
        ttlSeconds,
      )
      .zadd(indexKey, this.now() + ttlSeconds * 1_000, session.sessionId)
      // Every session shares the service TTL, so the latest heartbeat always
      // carries the furthest deadline and the index dies with its last session.
      .expire(indexKey, ttlSeconds)
      .exec();
  }

  async remove({
    projectId,
    sessionId,
  }: {
    projectId: string;
    sessionId: string;
  }): Promise<boolean> {
    // One transaction, so a heartbeat cannot land between the two and leave a live session
    // unindexed.
    const results = await this.redis
      .multi()
      .del(this.sessionKey(projectId, sessionId))
      .zrem(this.indexKey(projectId), sessionId)
      .exec();
    if (!results) throw new Error(`Failed to remove presence session ${sessionId}`);
    const failed = results.find(([error]) => error);
    if (failed?.[0]) throw failed[0];
    const [, deleted] = results[0] ?? [];
    return typeof deleted === "number" && deleted > 0;
  }

  async findSession({
    projectId,
    sessionId,
  }: {
    projectId: string;
    sessionId: string;
  }): Promise<PresenceSession | undefined> {
    const raw = await this.redis.get(this.sessionKey(projectId, sessionId));
    return raw ? this.parse(raw) : undefined;
  }

  async findByProject(projectId: string): Promise<PresenceSession[]> {
    const indexKey = this.indexKey(projectId);
    const now = this.now();
    const [, sessionIds] = await Promise.all([
      this.redis.zremrangebyscore(indexKey, "-inf", now),
      this.redis.zrangebyscore(indexKey, `(${now}`, "+inf"),
    ]);
    if (sessionIds.length === 0) return [];
    const values = await this.redis.mget(
      ...sessionIds.map((sessionId) => this.sessionKey(projectId, sessionId)),
    );
    return values.flatMap((raw) => {
      const session = raw ? this.parse(raw) : undefined;
      return session ? [session] : [];
    });
  }

  private parse(raw: string): PresenceSession | undefined {
    try {
      const parsed = presenceSessionSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private sessionKey(projectId: string, sessionId: string): string {
    return `${KEY_PREFIX}:{${projectId}}:${sessionId}`;
  }

  /** Outside the `{<projectId>}:*` namespace so it never collides with a session key. */
  private indexKey(projectId: string): string {
    return `${KEY_PREFIX}:index:{${projectId}}`;
  }
}
