import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { PresenceSession } from "../types";
import type { PresenceRepository } from "./presence.repository";

const KEY_PREFIX = "presence:v1";

function sessionKey(projectId: string, sessionId: string): string {
  return `${KEY_PREFIX}:${projectId}:${sessionId}`;
}

function projectScanPattern(projectId: string): string {
  return `${KEY_PREFIX}:${projectId}:*`;
}

export class RedisPresenceRepository implements PresenceRepository {
  constructor(private readonly redis: IORedis | Cluster) {}

  async upsert(session: PresenceSession, ttlSeconds: number): Promise<void> {
    const key = sessionKey(session.projectId, session.sessionId);
    await this.redis.set(key, JSON.stringify(session), "EX", ttlSeconds);
  }

  async remove(projectId: string, sessionId: string): Promise<boolean> {
    const removed = await this.redis.del(sessionKey(projectId, sessionId));
    return removed > 0;
  }

  async findByProjectId(projectId: string): Promise<PresenceSession[]> {
    const keys = await this.scanProjectKeys(projectId);
    if (keys.length === 0) return [];

    const values = await this.redis.mget(...keys);
    const sessions: PresenceSession[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        sessions.push(JSON.parse(raw) as PresenceSession);
      } catch {
        // ignore malformed entries; they will expire on their own
      }
    }
    return sessions;
  }

  private async scanProjectKeys(projectId: string): Promise<string[]> {
    const pattern = projectScanPattern(projectId);

    if (this.isCluster(this.redis)) {
      const seen = new Set<string>();
      const nodes = this.redis.nodes("master");
      await Promise.all(
        nodes.map(async (node) => {
          for (const key of await scanNode(node, pattern)) seen.add(key);
        }),
      );
      return Array.from(seen);
    }

    return scanNode(this.redis, pattern);
  }

  private isCluster(client: IORedis | Cluster): client is Cluster {
    return typeof (client as Cluster).nodes === "function";
  }
}

async function scanNode(
  node: { scan: IORedis["scan"] },
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
