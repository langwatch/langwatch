/**
 * The key/value substrate the CLI device grant keeps its short-lived state in.
 *
 * Every record the RFC 8628 flow writes is ephemeral and TTL'd — a device code
 * lives ten minutes, an access token an hour, a refresh token a quarter — so
 * the store is a cache with expiry rather than a table. That is why this is a
 * port over five operations instead of a repository: there is no row to read
 * back by anything but its own key, and no query to write.
 *
 * `setIfAbsent` is not a convenience. It IS the poll throttle: `/exchange`
 * claims a per-device-code window with one atomic write, and a get-then-set
 * spelled by hand would let two concurrent polls both see nothing and both
 * pass.
 *
 * Every write is single-key on purpose. A Redis cluster CROSSSLOT-rejects a
 * multi-key operation whose keys hash to different slots, and the device code,
 * its user-code index and the two token records always do.
 */
export abstract class CliDeviceSessionStorePort {
  /** The stored value at one key, or nothing. */
  abstract tryGet(key: string): Promise<string | null>;

  /** Writes one value with a lifetime, replacing whatever was there. */
  abstract set(input: { key: string; value: string; ttlSeconds: number }): Promise<void>;

  /**
   * Writes one value with a lifetime ONLY when the key is free, answering
   * whether this caller is the one that wrote it.
   *
   * The poll throttle's whole mechanism: `false` means someone already claimed
   * this window.
   */
  abstract setIfAbsent(input: { key: string; value: string; ttlSeconds: number }): Promise<boolean>;

  /** Drops one key. Absent is not an error — every caller here is idempotent. */
  abstract delete(key: string): Promise<void>;

  /**
   * Adds token keys to a user's index and re-stamps its lifetime.
   *
   * The index is what a deactivation sweep walks, so its own expiry is bumped
   * to the longest-lived member on every mint and rotation: it must outlive
   * every token it names, and self-evict once none of them can be live.
   */
  abstract indexTokens(input: {
    indexKey: string;
    memberKeys: string[];
    ttlMs: number;
  }): Promise<void>;

  /** Removes one token key from a user's index. */
  abstract removeFromIndex(input: { indexKey: string; memberKey: string }): Promise<void>;
}
