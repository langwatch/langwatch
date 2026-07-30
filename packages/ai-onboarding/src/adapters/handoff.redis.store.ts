import type { HandoffStore } from "../app/ports.js";
import type { ClaimHandoff } from "../domain/handoff.js";
import { KEY_PREFIX, type RedisLike } from "./redis.js";

/**
 * Handoffs in Redis, keyed by a hash of the handoff code and TTL'd to the
 * round-trip's lifetime.
 *
 * Redis rather than Postgres because a handoff is a 15-minute browser
 * round-trip, not state anyone needs after it: expiry is the store's job, and
 * a durable row would need its own sweep to stop accumulating. The 30-day
 * claim window lives on the account row, where it belongs.
 */
export class RedisHandoffStore implements HandoffStore {
  constructor(private readonly redis: RedisLike) {}

  async put(params: {
    codeHash: string;
    handoff: ClaimHandoff;
    ttlSeconds: number;
  }): Promise<void> {
    await this.redis.set(
      this.key(params.codeHash),
      JSON.stringify(params.handoff),
      "EX",
      params.ttlSeconds,
    );
  }

  async get(codeHash: string): Promise<ClaimHandoff | null> {
    const raw = await this.redis.get(this.key(codeHash));
    if (raw === null) return null;
    return JSON.parse(raw) as ClaimHandoff;
  }

  /**
   * Read-modify-write rather than a Lua script. The window between the two
   * calls is benign: the conditional `markClaimed` UPDATE on the account row
   * is what actually decides a double-approval race, so the worst outcome
   * here is a second approval finding the account already claimed and being
   * told so.
   */
  async approve(params: {
    codeHash: string;
    userId: string;
  }): Promise<ClaimHandoff | null> {
    const key = this.key(params.codeHash);
    const existing = await this.get(params.codeHash);
    if (existing === null || existing.status === "approved") return null;

    const ttl = await this.redis.ttl(key);
    if (ttl <= 0) return null;

    const approved: ClaimHandoff = {
      ...existing,
      status: "approved",
      approvedByUserId: params.userId,
    };
    await this.redis.set(key, JSON.stringify(approved), "EX", ttl);
    return approved;
  }

  async setPasskeyChallenge(params: {
    codeHash: string;
    challenge: string;
  }): Promise<ClaimHandoff | null> {
    const key = this.key(params.codeHash);
    const existing = await this.get(params.codeHash);
    if (existing === null) return null;

    const ttl = await this.redis.ttl(key);
    if (ttl <= 0) return null;

    const updated: ClaimHandoff = {
      ...existing,
      passkeyChallenge: params.challenge,
    };
    await this.redis.set(key, JSON.stringify(updated), "EX", ttl);
    return updated;
  }

  async consume(codeHash: string): Promise<void> {
    await this.redis.del(this.key(codeHash));
  }

  /**
   * A one-slot counter per interval: the first poll in a window creates the
   * key and is allowed, every later one finds it already there. Cheaper than
   * storing a last-polled timestamp and comparing clocks, and it expires
   * itself.
   */
  async allowPoll(params: {
    codeHash: string;
    intervalSeconds: number;
  }): Promise<boolean> {
    const key = `${KEY_PREFIX}:poll:${params.codeHash}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, params.intervalSeconds);
      return true;
    }
    return false;
  }

  private key(codeHash: string): string {
    return `${KEY_PREFIX}:handoff:${codeHash}`;
  }
}
