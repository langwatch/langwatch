import type { UsageCache } from "../app/entitlement.members.ts";

/** A cache that remembers nothing, for a process that composed none. */
export class NoUsageCache implements UsageCache {
  async tryGet<T>(): Promise<T | undefined> {
    return undefined;
  }

  async set(): Promise<void> {}
}

/**
 * In-process cache with `ttlMs` expiration. Enforcement asks the same questions
 * repeatedly; per-process suffices since they recur within seconds.
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
