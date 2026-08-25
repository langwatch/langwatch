import type { RedisConnection } from "./types";

/**
 * Closes Redis connections owned by a process composition root.
 *
 * ioredis exposes `disconnect()` on both standalone and cluster clients and
 * the existing App shutdown path deliberately uses it: shutdown must stop
 * reconnecting immediately rather than waiting for queued commands to drain.
 * Keeping that policy here gives every owner the same lifecycle operation and
 * makes repeated signal handling safe without putting connection state in a
 * module singleton.
 */
export class RedisShutdownService {
  private readonly closePromises = new WeakMap<RedisConnection, Promise<void>>();

  private constructor() {}

  static create(): RedisShutdownService {
    return new RedisShutdownService();
  }

  /** Disconnects a connection at most once for this shutdown owner. */
  shutdown(connection: RedisConnection): Promise<void> {
    const existing = this.closePromises.get(connection);
    if (existing) return existing;

    const closePromise = Promise.resolve().then(() => {
      connection.disconnect();
    });
    this.closePromises.set(connection, closePromise);
    return closePromise;
  }
}
