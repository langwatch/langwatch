import { createHash } from "node:crypto";

import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import type { HostedMcpRedis } from "../../app/hosted-mcp.members.ts";
import {
  McpSessionRepository,
  type McpSessionRecordLookup,
  type McpSessionTransport,
} from "../mcp-session.repository.ts";

/** Streamable records live as long as an OAuth bearer, SSE ones as long as their idle reap. */
const LAYOUT: Record<McpSessionTransport, { record: string; byKey: string; ttlSeconds: number }> = {
  streamable: { record: "mcp:session:", byKey: "mcp:sessions_by_key:", ttlSeconds: 30 * 24 * 3600 },
  sse: { record: "mcp:sse:session:", byKey: "mcp:sse:sessions_by_key:", ttlSeconds: 30 * 60 },
};

const storedSessionSchema = z.object({ encryptedApiKey: z.string() });

/**
 * An opaque stand-in for an API key in key names. Raw keys must never appear there: key names
 * show in admin tools, MONITOR, key dumps and metrics.
 */
function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

/** Session records in Redis. With no Redis every write is dropped and every read is missing. */
export class RedisMcpSessionRepository extends McpSessionRepository {
  readonly #redis: HostedMcpRedis | null;

  private constructor({ redis }: { redis: HostedMcpRedis | null }) {
    super();
    this.#redis = redis;
  }

  static create({ redis }: { redis: HostedMcpRedis | null }): RedisMcpSessionRepository {
    return new RedisMcpSessionRepository({ redis });
  }

  isAvailable(): boolean {
    return this.#redis !== null;
  }

  async store({
    transport,
    sessionId,
    apiKey,
    encryptedApiKey,
  }: {
    transport: McpSessionTransport;
    sessionId: string;
    apiKey: string;
    encryptedApiKey: string;
  }): Promise<void> {
    if (!this.#redis) return;
    const layout = LAYOUT[transport];
    const setKey = `${layout.byKey}${hashApiKey(apiKey)}`;
    await this.#redis.set(
      `${layout.record}${sessionId}`,
      JSON.stringify({ encryptedApiKey, createdAt: nowInstant().epochMilliseconds }),
      "EX",
      layout.ttlSeconds,
    );
    await this.#redis.sadd(setKey, sessionId);
    await this.#redis.expire(setKey, layout.ttlSeconds);
  }

  async touch({
    transport,
    sessionId,
    apiKey,
  }: {
    transport: McpSessionTransport;
    sessionId: string;
    apiKey: string;
  }): Promise<void> {
    if (!this.#redis) return;
    const layout = LAYOUT[transport];
    await this.#redis.expire(`${layout.record}${sessionId}`, layout.ttlSeconds);
    await this.#redis.expire(`${layout.byKey}${hashApiKey(apiKey)}`, layout.ttlSeconds);
  }

  async getRecord({
    transport,
    sessionId,
  }: {
    transport: McpSessionTransport;
    sessionId: string;
  }): Promise<McpSessionRecordLookup> {
    if (!this.#redis) return { kind: "missing" };
    const data = await this.#redis.get(`${LAYOUT[transport].record}${sessionId}`);
    if (!data) return { kind: "missing" };
    const stored = storedSessionSchema.parse(JSON.parse(data));
    return { kind: "found", encryptedApiKey: stored.encryptedApiKey };
  }

  async remove({
    transport,
    sessionId,
    apiKey,
  }: {
    transport: McpSessionTransport;
    sessionId: string;
    apiKey?: string;
  }): Promise<void> {
    if (!this.#redis) return;
    const layout = LAYOUT[transport];
    await this.#redis.del(`${layout.record}${sessionId}`);
    if (apiKey !== undefined) {
      await this.#redis.srem(`${layout.byKey}${hashApiKey(apiKey)}`, sessionId);
    }
  }

  async countLive({ apiKey }: { apiKey: string }): Promise<number> {
    const streamable = await this.#countLiveOf({ transport: "streamable", apiKey });
    const sse = await this.#countLiveOf({ transport: "sse", apiKey });
    return streamable + sse;
  }

  async #countLiveOf({
    transport,
    apiKey,
  }: {
    transport: McpSessionTransport;
    apiKey: string;
  }): Promise<number> {
    const redis = this.#redis;
    if (!redis) return 0;
    const layout = LAYOUT[transport];
    const setKey = `${layout.byKey}${hashApiKey(apiKey)}`;
    let liveCount = 0;
    for (const id of await redis.smembers(setKey)) {
      if (await redis.exists(`${layout.record}${id}`)) {
        liveCount++;
      } else {
        await redis.srem(setKey, id);
      }
    }
    return liveCount;
  }
}
