import { createHash } from "node:crypto";

import { nowInstant } from "@langwatch/time";
import type { Cluster, Redis } from "ioredis";
import { z } from "zod";

import {
  type McpSessionCipher,
  McpSessionRepository,
  type McpSessionRecordLookup,
} from "../mcp-session.repository.ts";

/**
 * A record lives 30 days past its last use. `activeByKey` is a sorted set of session ids scored by
 * last activity, a new name because the set it replaces (`mcp:sessions_by_key:`) is another type.
 */
const LAYOUT = {
  record: "mcp:session:",
  activeByKey: "mcp:active_sessions_by_key:",
  ttlSeconds: 30 * 24 * 3600,
} as const;

const storedSessionSchema = z.object({
  encryptedApiKey: z.string(),
  projectId: z.string().optional(),
  userId: z.string().optional(),
});

/**
 * An opaque stand-in for an API key in key names. Raw keys must never appear there: key names
 * show in admin tools, MONITOR, key dumps and metrics.
 */
function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

/**
 * Session records in Redis, the key sealed with the deployment's cipher. With no Redis every
 * write is dropped and every read is missing.
 */
export class RedisMcpSessionRepository extends McpSessionRepository {
  readonly #redis: Redis | Cluster | null;
  readonly #cipher: McpSessionCipher;

  private constructor({
    redis,
    cipher,
  }: {
    redis: Redis | Cluster | null;
    cipher: McpSessionCipher;
  }) {
    super();
    this.#redis = redis;
    this.#cipher = cipher;
  }

  static create(input: {
    redis: Redis | Cluster | null;
    cipher: McpSessionCipher;
  }): RedisMcpSessionRepository {
    return new RedisMcpSessionRepository(input);
  }

  isAvailable(): boolean {
    return this.#redis !== null;
  }

  async store({
    sessionId,
    apiKey,
    projectId,
    userId,
  }: {
    sessionId: string;
    apiKey: string;
    projectId?: string;
    userId?: string;
  }): Promise<void> {
    if (!this.#redis) return;
    const encryptedApiKey = this.#cipher.encrypt(apiKey);
    await this.#redis.set(
      `${LAYOUT.record}${sessionId}`,
      JSON.stringify({
        encryptedApiKey,
        projectId,
        userId,
        createdAt: nowInstant().epochMilliseconds,
      }),
      "EX",
      LAYOUT.ttlSeconds,
    );
    await this.#markActive({ sessionId, apiKey });
  }

  async touch({ sessionId, apiKey }: { sessionId: string; apiKey: string }): Promise<void> {
    if (!this.#redis) return;
    await this.#redis.expire(`${LAYOUT.record}${sessionId}`, LAYOUT.ttlSeconds);
    await this.#markActive({ sessionId, apiKey });
  }

  async getRecord({ sessionId }: { sessionId: string }): Promise<McpSessionRecordLookup> {
    if (!this.#redis) return { kind: "missing" };
    const data = await this.#redis.get(`${LAYOUT.record}${sessionId}`);
    if (!data) return { kind: "missing" };
    const stored = storedSessionSchema.parse(JSON.parse(data));
    return {
      kind: "found",
      apiKey: this.#cipher.decrypt(stored.encryptedApiKey),
      projectId: stored.projectId,
      userId: stored.userId,
    };
  }

  async remove({ sessionId, apiKey }: { sessionId: string; apiKey?: string }): Promise<void> {
    if (!this.#redis) return;
    await this.#redis.del(`${LAYOUT.record}${sessionId}`);
    if (apiKey !== undefined) await this.forgetKey({ sessionId, apiKey });
  }

  async forgetKey({ sessionId, apiKey }: { sessionId: string; apiKey: string }): Promise<void> {
    if (!this.#redis) return;
    await this.#redis.zrem(activeKeyOf(apiKey), sessionId);
  }

  /** Entries older than a record's whole life are pruned on the way, so the set stays bounded. */
  async countActive({ apiKey, since }: { apiKey: string; since: number }): Promise<number> {
    const redis = this.#redis;
    if (!redis) return 0;
    const setKey = activeKeyOf(apiKey);
    const oldestLive = nowInstant().epochMilliseconds - LAYOUT.ttlSeconds * 1000;
    await redis.zremrangebyscore(setKey, "-inf", `(${oldestLive}`);
    return (await redis.zrangebyscore(setKey, since, "+inf")).length;
  }

  async #markActive({ sessionId, apiKey }: { sessionId: string; apiKey: string }): Promise<void> {
    const redis = this.#redis;
    if (!redis) return;
    const setKey = activeKeyOf(apiKey);
    await redis.zadd(setKey, nowInstant().epochMilliseconds, sessionId);
    await redis.expire(setKey, LAYOUT.ttlSeconds);
  }
}

function activeKeyOf(apiKey: string): string {
  return `${LAYOUT.activeByKey}${hashApiKey(apiKey)}`;
}
