import {
  presenceSessionSchema,
  type PresenceSession,
} from "@langwatch/presence-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type Redis from "ioredis";
import type { Cluster } from "ioredis";
import { PresenceRepository } from "../presence.repository";

const KEY_PREFIX = "presence:v1";

export class RedisPresenceRepository extends PresenceRepository {
  private constructor(private readonly redis: RedisConnection) {
    super();
  }

  static create(redis: RedisConnection): RedisPresenceRepository {
    return new RedisPresenceRepository(redis);
  }

  async upsert(
    session: PresenceSession,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(
      this.sessionKey(session.projectId, session.sessionId),
      JSON.stringify(session),
      "EX",
      ttlSeconds,
    );
  }

  async remove(projectId: string, sessionId: string): Promise<boolean> {
    return (
      (await this.redis.del(this.sessionKey(projectId, sessionId))) > 0
    );
  }

  async tryFindSession(
    projectId: string,
    sessionId: string,
  ): Promise<PresenceSession | null> {
    const raw = await this.redis.get(this.sessionKey(projectId, sessionId));
    return raw ? this.parse(raw) : null;
  }

  async listByProject(projectId: string): Promise<PresenceSession[]> {
    const keys = await this.scanProjectKeys(projectId);
    if (keys.length === 0) return [];
    const values = await this.redis.mget(...keys);
    return values.flatMap((raw) => {
      const session = raw ? this.parse(raw) : undefined;
      return session ? [session] : [];
    });
  }

  private parse(raw: string): PresenceSession | null {
    try {
      const parsed = presenceSessionSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async scanProjectKeys(projectId: string): Promise<string[]> {
    const pattern = `${KEY_PREFIX}:${projectId}:*`;
    if (this.isCluster(this.redis)) {
      const seen = new Set<string>();
      await Promise.all(
        this.redis.nodes("master").map(async (node) => {
          for (const key of await scanNode(node, pattern)) seen.add(key);
        }),
      );
      return [...seen];
    }
    return scanNode(this.redis, pattern);
  }

  private isCluster(client: RedisConnection): client is Cluster {
    return typeof (client as Cluster).nodes === "function";
  }

  private sessionKey(projectId: string, sessionId: string): string {
    return `${KEY_PREFIX}:${projectId}:${sessionId}`;
  }
}

async function scanNode(
  node: { scan: Redis["scan"] },
  pattern: string,
): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, batch] = await node.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      256,
    );
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}
