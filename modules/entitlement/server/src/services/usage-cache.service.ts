import type { UsageCache } from "../app/entitlement.infrastructure.ts";

/** A cache that remembers nothing, for a process that composed none. */
export class NoUsageCache implements UsageCache {
  async tryGet<T>(): Promise<T | undefined> {
    return undefined;
  }
  async set(): Promise<void> {}
}

/**
 * The cache a process composes when it has nowhere shared to keep one: a map
 * in this process, expiring each key after `ttlMs`.
 *
 * Enforcement asks the same two questions on every ingested batch, so without
 * a cache a busy project re-runs the month's count per batch. Per-process is
 * enough for that: the questions repeat within seconds, and the worst a cold
 * pod costs is one extra read.
 */
export class InProcessUsageCache implements UsageCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async tryGet<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }
}
