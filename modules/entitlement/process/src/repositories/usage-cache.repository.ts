/**
 * A short-lived per-key cache. Enforcement asks the same two questions on every ingested batch,
 * so the composition binds whatever it has: a cache shared across pods, or a per-pod map.
 */
export interface UsageCacheRepository {
  findValue<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}
