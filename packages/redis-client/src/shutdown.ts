import type { RedisConnection } from "./types.ts";

/**
 * Closes Redis connections owned by a process composition root. Uses
 * `disconnect()`, not a graceful close: shutdown must stop reconnecting
 * immediately rather than wait for queued commands to drain. Instance-scoped
 * (not a module singleton) so repeated signal handling stays safe.
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
