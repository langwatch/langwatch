/**
 * A short-lived per-key cache. Enforcement asks the same two questions on every ingested batch,
 * so the composition binds whatever it has — a Redis cache shared across pods, or a per-pod map
 * — and the absence of one only costs repeated reads.
 */
export abstract class UsageCachePort {
  abstract tryGet<T>(key: string): Promise<T | undefined>;
  abstract set<T>(key: string, value: T): Promise<void>;
}

/** A cache that remembers nothing, for a process that composed none. */
export class NoUsageCache extends UsageCachePort {
  async tryGet<T>(): Promise<T | undefined> {
    return undefined;
  }
  async set(): Promise<void> {}
}
