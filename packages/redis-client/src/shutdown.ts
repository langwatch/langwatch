import { endPromptly, familyOf } from "./client-family.ts";
import type { RedisConnection } from "./types.ts";

/**
 * Uses `disconnect()`, not a graceful close: shutdown must stop reconnecting
 * immediately rather than wait for queued commands to drain. Instance-scoped
 * so repeated signal handling stays safe.
 */
export class RedisShutdownService {
  private readonly closePromises = new WeakMap<RedisConnection, Promise<void>>();

  private constructor() {}

  static create(): RedisShutdownService {
    return new RedisShutdownService();
  }

  /**
   * Called before anything drains: from here no client of this connection, its
   * duplicates included, reconnects, so a command against a lost Redis fails
   * at once. A reachable Redis keeps answering, so drains still finish.
   */
  beginShutdown(connection: RedisConnection): void {
    familyOf(connection)?.beginShutdown();
  }

  /** Disconnects a connection at most once for this shutdown owner. */
  shutdown(connection: RedisConnection): Promise<void> {
    const existing = this.closePromises.get(connection);
    if (existing) return existing;

    const closePromise = Promise.resolve().then(() => {
      const family = familyOf(connection);
      if (family === undefined) {
        connection.disconnect();
        return;
      }
      family.beginShutdown();
      endPromptly(connection);
    });
    this.closePromises.set(connection, closePromise);
    return closePromise;
  }
}
