/**
 * The Redis half of the agent state store, against a fake connection: when a
 * subscriber starts receiving, and what a failed transaction command does.
 *
 * @see specs/agents/connected-agents.feature
 */
import type { RedisConnection } from "@langwatch/redis-client";
import { describe, expect, it } from "vitest";
import { createRedisStateStore } from "../state-store";

type MessageListener = (channel: string, message: string) => void;

/**
 * A connection that hands out the SUBSCRIBE deferral, so a test can deliver a
 * message while the command is still in flight.
 */
function fakeSubscriberRedis() {
  let listener: MessageListener | null = null;
  const subscribed: string[] = [];
  let release: (() => void) | null = null;

  const connection = {
    on(event: string, handler: MessageListener) {
      if (event === "message") listener = handler;
    },
    async subscribe(channel: string) {
      subscribed.push(channel);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return 1;
    },
    async unsubscribe() {
      return 0;
    },
    async quit() {
      return "OK";
    },
  };

  return {
    redis: {
      duplicate: () => connection as unknown as RedisConnection,
    } as unknown as RedisConnection,
    subscribed,
    deliver: (channel: string, message: string) => listener?.(channel, message),
    finishSubscribe: () => release?.(),
  };
}

/** A connection whose transaction answers with the tuples given. */
function fakeMultiRedis(tuples: [Error | null, unknown][] | null) {
  const chain = {
    incr: () => chain,
    expire: () => chain,
    async exec() {
      return tuples;
    },
  };
  return {
    duplicate: () => ({}) as RedisConnection,
    multi: () => chain,
  } as unknown as RedisConnection;
}

describe("createRedisStateStore", () => {
  describe("when a message arrives before SUBSCRIBE resolves", () => {
    it("delivers it to the handler that asked for the channel", async () => {
      const fake = fakeSubscriberRedis();
      const store = createRedisStateStore(fake.redis);
      const seen: string[] = [];

      const subscribing = store.subscribe("channel_1", (message) =>
        seen.push(message),
      );
      // The command is acknowledged by Redis before its promise settles here.
      await Promise.resolve();
      fake.deliver("channel_1", "early");
      fake.finishSubscribe();
      const unsubscribe = await subscribing;

      expect(seen).toEqual(["early"]);
      await unsubscribe();
      await store.close();
    });
  });

  describe("when a second handler asks for a channel still subscribing", () => {
    it("waits for the first SUBSCRIBE instead of returning early", async () => {
      const fake = fakeSubscriberRedis();
      const store = createRedisStateStore(fake.redis);

      const first = store.subscribe("channel_1", () => undefined);
      let secondSettled = false;
      const second = store
        .subscribe("channel_1", () => undefined)
        .then((unsubscribe) => {
          secondSettled = true;
          return unsubscribe;
        });
      await Promise.resolve();
      await Promise.resolve();

      expect(secondSettled).toBe(false);

      fake.finishSubscribe();
      await Promise.all([first, second]);

      expect(secondSettled).toBe(true);
      expect(fake.subscribed).toEqual(["channel_1"]);
      await store.close();
    });
  });

  describe("when the INCR of a transaction fails", () => {
    it("raises the error instead of reporting a count of zero", async () => {
      const failure = new Error("WRONGTYPE");
      const store = createRedisStateStore(
        fakeMultiRedis([
          [failure, null],
          [null, 1],
        ]),
      );

      await expect(store.incr("counter_1", 30)).rejects.toBe(failure);
    });

    it("reports the count when the command succeeded", async () => {
      const store = createRedisStateStore(
        fakeMultiRedis([
          [null, 3],
          [null, 1],
        ]),
      );

      await expect(store.incr("counter_1", 30)).resolves.toBe(3);
    });
  });
});
