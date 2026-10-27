import type { RedisConnection } from "@langwatch/redis-client";

import {
  type WorkspaceNudge,
  workspaceNudgeSchema,
} from "../../rules/langy-local-call-record.rules.ts";
import { workspaceChannel } from "../../rules/langy-local-control-keys.rules.ts";
import { LangyLocalWorkspaceChannel, type Unsubscribe } from "../langy-local-workspace.channel.ts";

/**
 * Redis pub/sub. A subscribing connection can run nothing else, so every
 * listener on this pod shares one dedicated connection, opened on first listen.
 */
export class RedisLangyLocalWorkspaceChannel extends LangyLocalWorkspaceChannel {
  readonly #redis: RedisConnection;
  readonly #handlers = new Map<string, Set<(raw: string) => void>>();
  readonly #subscribing = new Map<string, Promise<void>>();
  #subscriber: RedisConnection | null = null;

  private constructor(redis: RedisConnection) {
    super();
    this.#redis = redis;
  }

  static create(redis: RedisConnection): RedisLangyLocalWorkspaceChannel {
    return new RedisLangyLocalWorkspaceChannel(redis);
  }

  async nudge({
    conversationId,
    nudge,
  }: {
    conversationId: string;
    nudge: WorkspaceNudge;
  }): Promise<void> {
    await this.#redis.publish(workspaceChannel(conversationId), JSON.stringify(nudge));
  }

  listen({
    conversationId,
    onNudge,
  }: {
    conversationId: string;
    onNudge: (nudge: WorkspaceNudge) => void;
  }): Promise<Unsubscribe> {
    return this.#subscribe(workspaceChannel(conversationId), (raw) => {
      const nudge = parseNudge(raw);
      if (nudge) onNudge(nudge);
    });
  }

  async close(): Promise<void> {
    this.#handlers.clear();
    this.#subscribing.clear();
    if (!this.#subscriber) return;
    const closing = this.#subscriber;
    this.#subscriber = null;
    await closing.quit().catch(() => undefined);
  }

  async #subscribe(channel: string, handler: (raw: string) => void): Promise<Unsubscribe> {
    const connection = this.#openSubscriber();
    let handlers = this.#handlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(channel, handlers);
      // Redis delivers from the moment SUBSCRIBE is acknowledged, so the handler
      // is registered before the command is awaited. A failed SUBSCRIBE drops
      // the channel again, so the next caller starts a fresh one.
      this.#subscribing.set(
        channel,
        connection.subscribe(channel).then(
          () => {
            this.#subscribing.delete(channel);
          },
          (error: unknown) => {
            this.#subscribing.delete(channel);
            this.#handlers.delete(channel);
            throw error;
          },
        ),
      );
    }
    handlers.add(handler);
    // A second caller for the same channel waits for the first SUBSCRIBE.
    await this.#subscribing.get(channel);
    return async () => {
      const current = this.#handlers.get(channel);
      current?.delete(handler);
      if (current && current.size === 0) {
        this.#handlers.delete(channel);
        await connection.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  #openSubscriber(): RedisConnection {
    if (this.#subscriber) return this.#subscriber;
    const subscriber = this.#redis.duplicate();
    subscriber.on("message", (channel: string, message: string) => {
      for (const handler of this.#handlers.get(channel) ?? []) handler(message);
    });
    this.#subscriber = subscriber;
    return subscriber;
  }
}

/** A nudge from another pod, or null when it is not one this build understands. */
function parseNudge(raw: string): WorkspaceNudge | null {
  try {
    const parsed = workspaceNudgeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
