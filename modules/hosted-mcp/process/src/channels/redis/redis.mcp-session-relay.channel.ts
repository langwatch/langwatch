import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";

import { McpSessionRelayChannel } from "../mcp-session-relay.channel.ts";

const logger = createLogger("langwatch:mcp");

const RELAY_CHANNEL_PREFIX = "mcp:sse:relay:";

function relayChannel(sessionId: string): string {
  return `${RELAY_CHANNEL_PREFIX}${sessionId}`;
}

/**
 * Redis pub/sub. ioredis puts a subscribing connection into a mode where it can run no other
 * command, so listening opens one dedicated connection, lazily, that covers every session.
 */
export class RedisMcpSessionRelayChannel extends McpSessionRelayChannel {
  readonly #redis: Redis | Cluster | null;
  readonly #listeners = new Map<string, (raw: string) => void>();
  #subscriber: Redis | Cluster | undefined;

  private constructor({ redis }: { redis: Redis | Cluster | null }) {
    super();
    this.#redis = redis;
  }

  static create({ redis }: { redis: Redis | Cluster | null }): RedisMcpSessionRelayChannel {
    return new RedisMcpSessionRelayChannel({ redis });
  }

  async listen({
    sessionId,
    onMessage,
  }: {
    sessionId: string;
    onMessage: (raw: string) => void;
  }): Promise<void> {
    const subscriber = this.#openSubscriber();
    if (!subscriber) return;

    const channel = relayChannel(sessionId);
    this.#listeners.set(channel, onMessage);
    try {
      await subscriber.subscribe(channel);
    } catch (err) {
      this.#listeners.delete(channel);
      logger.error({ error: err, sessionId }, "Failed to subscribe to the MCP SSE relay channel");
    }
  }

  async stopListening({ sessionId }: { sessionId: string }): Promise<void> {
    const channel = relayChannel(sessionId);
    this.#listeners.delete(channel);
    if (this.#subscriber) {
      await this.#subscriber.unsubscribe(channel).catch(() => undefined);
    }
  }

  async publish({ sessionId, message }: { sessionId: string; message: string }): Promise<number> {
    if (!this.#redis) return 0;
    return this.#redis.publish(relayChannel(sessionId), message);
  }

  close(): void {
    this.#listeners.clear();
    this.#subscriber?.disconnect();
    this.#subscriber = undefined;
  }

  #openSubscriber(): Redis | Cluster | undefined {
    if (this.#subscriber) return this.#subscriber;
    if (!this.#redis) return undefined;
    try {
      const subscriber = this.#redis.duplicate();
      subscriber.on("message", (channel: string, message: string) => {
        this.#listeners.get(channel)?.(message);
      });
      subscriber.on("error", (err: unknown) => {
        logger.error({ error: err }, "MCP SSE relay subscriber error");
      });
      this.#subscriber = subscriber;
      return subscriber;
    } catch (err) {
      logger.error({ error: err }, "Failed to open MCP SSE relay subscriber");
      return undefined;
    }
  }
}
