/**
 * One-time reveals in Redis: the sealed secret under one key, and the marker
 * a served read leaves behind under another. Both expire on the same clock.
 */
import type { RedisConnection } from "@langwatch/redis-client";

import type {
  OneTimeRevealRepository,
  StoredReveal,
  TakenReveal,
} from "../one-time-reveal.repository.ts";

const secretKey = (organizationId: string, revealId: string) =>
  `secret_reveal:${organizationId}:${revealId}`;
const markerKey = (organizationId: string, revealId: string) =>
  `secret_revealed:${organizationId}:${revealId}`;

/** Redis below 6.2 has no GETDEL; the server refusing it is the only signal. */
function isUnknownCommand(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && /unknown command/i.test(message);
}

export class RedisOneTimeRevealRepository implements OneTimeRevealRepository {
  static create({ redis }: { redis: RedisConnection }): RedisOneTimeRevealRepository {
    return new RedisOneTimeRevealRepository(redis);
  }

  private constructor(private readonly redis: RedisConnection) {}

  async put({
    organizationId,
    revealId,
    reveal,
    ttlMs,
  }: {
    organizationId: string;
    revealId: string;
    reveal: StoredReveal;
    ttlMs: number;
  }): Promise<void> {
    await this.redis.set(secretKey(organizationId, revealId), JSON.stringify(reveal), "PX", ttlMs);
  }

  async take({
    organizationId,
    revealId,
  }: {
    organizationId: string;
    revealId: string;
  }): Promise<TakenReveal> {
    const raw = await this.getdel(secretKey(organizationId, revealId));
    if (raw === null) return { taken: false };

    return { taken: true, reveal: JSON.parse(raw) as StoredReveal };
  }

  async markServed({
    organizationId,
    revealId,
    ttlMs,
  }: {
    organizationId: string;
    revealId: string;
    ttlMs: number;
  }): Promise<void> {
    await this.redis.set(markerKey(organizationId, revealId), "1", "PX", ttlMs);
  }

  async wasServed({
    organizationId,
    revealId,
  }: {
    organizationId: string;
    revealId: string;
  }): Promise<boolean> {
    return (await this.redis.exists(markerKey(organizationId, revealId))) > 0;
  }

  /** Read-and-delete in one command, so two reads racing cannot both be served.
   *  The two-step fallback is for a server old enough to refuse GETDEL. */
  private async getdel(key: string): Promise<string | null> {
    try {
      return await this.redis.getdel(key);
    } catch (error) {
      if (!isUnknownCommand(error)) throw error;
    }

    const value = await this.redis.get(key);
    if (value !== null) await this.redis.del(key);

    return value;
  }
}
