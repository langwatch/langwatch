/**
 * CLI device grant's ephemeral key/value store. RFC 8628 flow writes TTL'd
 * records (cache not table); single-key ops to avoid Redis CROSSSLOT.
 */
export interface CliDeviceSessionRepository {
  /** The stored value at one key; throws `CliSessionRecordNotFoundError` when none is held. */
  get(key: string): Promise<string>;

  /** Writes one value with a lifetime, replacing whatever was there. */
  set(input: { key: string; value: string; ttlSeconds: number }): Promise<void>;

  /**
   * Writes one value with a lifetime ONLY when the key is free, answering
   * whether this caller wrote it. The poll throttle's whole mechanism:
   * `false` means someone already claimed this window.
   */
  setIfAbsent(input: { key: string; value: string; ttlSeconds: number }): Promise<boolean>;

  /** Drops one key. Absent is not an error - every caller here is idempotent. */
  delete(key: string): Promise<void>;

  /**
   * Adds token keys to a user's index and re-stamps its lifetime. A
   * deactivation sweep walks this index, so its expiry is bumped to the
   * longest-lived member on every mint: it must outlive every token it names.
   */
  indexTokens(input: { indexKey: string; memberKeys: string[]; ttlMs: number }): Promise<void>;

  /** Removes one token key from a user's index. */
  removeFromIndex(input: { indexKey: string; memberKey: string }): Promise<void>;

  /** The token keys a user's index names, lapsed ones included. */
  findIndexedTokens(indexKey: string): Promise<string[]>;

  /** Drops token records and their index entries, answering how many records were held. */
  deleteIndexedTokens(input: { indexKey: string; memberKeys: readonly string[] }): Promise<number>;
}
