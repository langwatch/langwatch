/**
 * CLI device grant's ephemeral key/value store. RFC 8628 flow writes TTL'd
 * records (cache not table); single-key ops to avoid Redis CROSSSLOT.
 */
export interface CliDeviceSessionRepository {
  /** The stored value at one key, or nothing. */
  tryGet(key: string): Promise<string | null>;

  /** Writes one value with a lifetime, replacing whatever was there. */
  set(input: { key: string; value: string; ttlSeconds: number }): Promise<void>;

  /**
   * Writes one value with a lifetime ONLY when the key is free, answering
   * whether this caller is the one that wrote it.
   *
   * The poll throttle's whole mechanism: `false` means someone already claimed
   * this window.
   */
  setIfAbsent(input: { key: string; value: string; ttlSeconds: number }): Promise<boolean>;

  /** Drops one key. Absent is not an error - every caller here is idempotent. */
  delete(key: string): Promise<void>;

  /**
   * Adds token keys to a user's index and re-stamps its lifetime.
   *
   * The index is what a deactivation sweep walks, so its own expiry is bumped
   * to the longest-lived member on every mint and rotation: it must outlive
   * every token it names, and self-evict once none of them can be live.
   */
  indexTokens(input: {
    indexKey: string;
    memberKeys: string[];
    ttlMs: number;
  }): Promise<void>;

  /** Removes one token key from a user's index. */
  removeFromIndex(input: { indexKey: string; memberKey: string }): Promise<void>;
}
