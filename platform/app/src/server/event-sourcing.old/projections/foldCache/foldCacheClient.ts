import type { Cluster, Redis } from "ioredis";

/**
 * The cache tier {@link CachedFoldStore} reads and writes — two single-key
 * operations, and deliberately nothing else.
 *
 * Narrow on purpose. The multi-key commands (`mget`, `pipeline`, `scan`, a
 * multi-key `del`) are the ones that break once keys span Redis Cluster slots,
 * and they are the change nobody thinks to check. They are not on this type, so
 * reaching for one is a compile error rather than a cross-slot failure in a
 * deployment nobody tested.
 *
 * It is also what keeps the store free of any storage vocabulary: no `"EX"`
 * token, no client type, no ioredis import.
 */
export interface FoldCacheClient {
  read(key: string): Promise<string | null>;
  /**
   * Writes an entry that MUST expire after `ttlSeconds`. The expiry is a
   * correctness invariant, not housekeeping — ADR-099: a miss is treated as
   * authoritative because it means the last write is at least a TTL old and has
   * therefore settled across the ClickHouse replicas. An implementation that
   * ignores the TTL breaks the fold's read-your-write guarantee.
   */
  write(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * The ioredis adapter — and the ONE place the `Redis | Cluster` question is
 * answered for fold projections (ADR-102).
 *
 * It is answered by not asking: `get` and `set` are single-key, both client
 * types expose them identically, and a Cluster client routes each key to its
 * owning slot. So there is no `instanceof` branch and no `as Redis` here, and
 * the union stops at this class — layer 1, where ADR-102 says it is legitimate
 * and where it must end.
 *
 * Topology therefore cannot decide whether folds are cached. That matters
 * because ADR-099 makes the fold cache the event processor's read-your-write
 * consistency layer rather than an accelerator: skipping it under Cluster would
 * take a correctness invariant away from the fold writers.
 */
export class RedisFoldCacheClient implements FoldCacheClient {
  constructor(private readonly redis: Redis | Cluster) {}

  async read(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async write(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, "EX", ttlSeconds);
  }
}

/**
 * A `Map`-backed tier — the client for a process running without Redis
 * (`SKIP_REDIS`, dev-without-Redis, tests), matching how every other
 * Redis-dependent service in the app degrades.
 *
 * **Correct only where exactly one process folds an aggregate**, which is
 * precisely that case: the event-sourcing queues are Redis, so a deployment
 * without it is not running a fleet of workers. Read-your-write still holds
 * within the process, which is strictly better than reading through to a
 * ClickHouse replica that may not have caught up. Give a multi-process
 * deployment this client and each pod would serve its own stale view — so the
 * composition root picks it only on the no-Redis branch, never as a fallback.
 *
 * **It expires entries, because the interface says entries expire.** Redis
 * `SET … EX` is not an optimisation this implementation may skip: a permanent
 * hit means dev and every integration run never once take the store's
 * ClickHouse read-back path, so a bug there is invisible until production —
 * and the `Map` grows for the process lifetime. Expiry is enforced lazily on
 * read, plus an amortised sweep on write — there is no timer, because a client
 * used by tests must not hold one. Read-time expiry alone would not be enough:
 * an entry written and never read again is never reached, so the `Map` would
 * still grow without bound. The sweep runs at most once a second, so it costs
 * one pass over live entries rather than a pass per write. From a caller's
 * point of view this is the same shape Redis has: a key past its TTL is simply
 * not there.
 *
 * Being a real implementation rather than a no-op double, it is also what tests
 * exercise the store's hit, miss and TTL paths with.
 */
/** Shortest interval between two write-time sweeps. */
const SWEEP_INTERVAL_MS = 1_000;

export class InMemoryFoldCacheClient implements FoldCacheClient {
  readonly entries = new Map<string, { value: string; expiresAt: number }>();
  private nextSweepAt = 0;

  async read(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async write(key: string, value: string, ttlSeconds: number): Promise<void> {
    const now = Date.now();
    if (now >= this.nextSweepAt) {
      this.nextSweepAt = now + SWEEP_INTERVAL_MS;
      for (const [existingKey, entry] of this.entries) {
        if (entry.expiresAt <= now) this.entries.delete(existingKey);
      }
    }
    this.entries.set(key, {
      value,
      expiresAt: now + ttlSeconds * 1000,
    });
  }
}
