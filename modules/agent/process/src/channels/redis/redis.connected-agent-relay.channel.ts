import {
  type InstanceGone,
  instanceGoneSchema,
  type InstanceNudge,
  instanceNudgeSchema,
  type ReplyNudge,
  replyNudgeSchema,
} from "@langwatch/agent-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { z } from "zod";

import {
  INSTANCE_GONE_CHANNEL,
  instanceChannel,
  replyChannel,
} from "../../rules/connected-agent-keys.rules.ts";
import { ConnectedAgentRelayChannel, type Unsubscribe } from "../connected-agent-relay.channel.ts";

/**
 * Redis pub/sub. A subscribing connection can run nothing else, so every
 * listener on this pod shares one dedicated connection, opened on first listen.
 */
export class RedisConnectedAgentRelayChannel extends ConnectedAgentRelayChannel {
  readonly shared = true;
  readonly #redis: RedisConnection;
  readonly #handlers = new Map<string, Set<(raw: string) => void>>();
  readonly #subscribing = new Map<string, Promise<void>>();
  #subscriber: RedisConnection | null = null;

  private constructor(redis: RedisConnection) {
    super();
    this.#redis = redis;
  }

  static create(redis: RedisConnection): RedisConnectedAgentRelayChannel {
    return new RedisConnectedAgentRelayChannel(redis);
  }

  nudgeInstance({
    projectId,
    instanceId,
    nudge,
  }: {
    projectId: string;
    instanceId: string;
    nudge: InstanceNudge;
  }): Promise<number> {
    return this.#redis.publish(instanceChannel(projectId, instanceId), JSON.stringify(nudge));
  }

  listenToInstance({
    projectId,
    instanceId,
    onNudge,
  }: {
    projectId: string;
    instanceId: string;
    onNudge: (nudge: InstanceNudge) => void;
  }): Promise<Unsubscribe> {
    return this.#subscribe(
      instanceChannel(projectId, instanceId),
      parsedBy(instanceNudgeSchema, onNudge),
    );
  }

  async nudgeReply({ podId, nudge }: { podId: string; nudge: ReplyNudge }): Promise<void> {
    await this.#redis.publish(replyChannel(podId), JSON.stringify(nudge));
  }

  listenForReplies({
    podId,
    onReply,
  }: {
    podId: string;
    onReply: (nudge: ReplyNudge) => void;
  }): Promise<Unsubscribe> {
    return this.#subscribe(replyChannel(podId), parsedBy(replyNudgeSchema, onReply));
  }

  async announceInstanceGone(gone: InstanceGone): Promise<void> {
    await this.#redis.publish(INSTANCE_GONE_CHANNEL, JSON.stringify(gone));
  }

  listenForInstanceGone(onGone: (gone: InstanceGone) => void): Promise<Unsubscribe> {
    return this.#subscribe(INSTANCE_GONE_CHANNEL, parsedBy(instanceGoneSchema, onGone));
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

/** A raw message read as its schema; one that does not read is dropped. */
function parsedBy<Schema extends z.ZodType>(
  schema: Schema,
  onMessage: (message: z.output<Schema>) => void,
): (raw: string) => void {
  return (raw) => {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) onMessage(parsed.data);
  };
}
