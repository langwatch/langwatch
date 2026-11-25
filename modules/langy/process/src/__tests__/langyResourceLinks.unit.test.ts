/**
 * The resource-link store is Langy's per-CONVERSATION memory of which platform address a lookup
 * surfaced for a resource — the only thing a later `langwatch navigate open <id>` may resolve
 * an address from.
 */
import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import type { RedisKey } from "ioredis";
import { describe, expect, it, vi } from "vitest";

import { LangyResourceLinksRedisRepository } from "../repositories/redis/redis.langy-resource-links.repository.ts";

function fakeRedis() {
  const keys = memoryRedisStore();
  const recorder = memoryRedisDouble({ store: keys });
  const hset = vi.fn((key: RedisKey, ...fieldValues: (string | number | Buffer)[]) =>
    recorder.hset(key, ...fieldValues),
  );
  const expire = vi.fn(async (..._args: unknown[]) => 1);
  const redis = memoryRedisDouble({ store: keys, script: { hset, expire } });
  return { redis, hset, expire };
}

describe("langyResourceLinkStore", () => {
  describe("when a lookup surfaces links and a later turn resolves them", () => {
    it("resolves every id a remembered link was keyed under", async () => {
      const { redis } = fakeRedis();
      const store = LangyResourceLinksRedisRepository.create({ redis });
      const href =
        "https://app.langwatch.ai/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1";
      await store.remember({
        conversationId: "conv-1",
        links: [
          { id: "batch_1", href },
          { id: "run_1", href },
        ],
      });

      expect(await store.resolve({ conversationId: "conv-1", id: "batch_1" })).toEqual({
        kind: "hit",
        href,
      });
      expect(await store.resolve({ conversationId: "conv-1", id: "run_1" })).toEqual({
        kind: "hit",
        href,
      });
    });

    it("answers a miss for a resource this conversation never surfaced", async () => {
      const { redis } = fakeRedis();
      const store = LangyResourceLinksRedisRepository.create({ redis });

      expect(await store.resolve({ conversationId: "conv-1", id: "unknown" })).toEqual({
        kind: "miss",
      });
    });
  });

  describe("when two conversations remember the same resource id", () => {
    it("keeps each conversation's links invisible to the other", async () => {
      const { redis } = fakeRedis();
      const store = LangyResourceLinksRedisRepository.create({ redis });
      await store.remember({
        conversationId: "conv-1",
        links: [{ id: "run_1", href: "https://app.langwatch.ai/a/x" }],
      });

      expect(await store.resolve({ conversationId: "conv-2", id: "run_1" })).toEqual({
        kind: "miss",
      });
    });
  });

  describe("when links are written", () => {
    it("refreshes the conversation key's TTL on every write", async () => {
      const { redis, expire } = fakeRedis();
      const store = LangyResourceLinksRedisRepository.create({ redis });
      await store.remember({
        conversationId: "conv-1",
        links: [{ id: "run_1", href: "https://app.langwatch.ai/a/x" }],
      });
      await store.remember({
        conversationId: "conv-1",
        links: [{ id: "run_2", href: "https://app.langwatch.ai/a/y" }],
      });

      expect(expire).toHaveBeenCalledTimes(2);
      expect(expire).toHaveBeenCalledWith("langy:navlink:conv-1", expect.any(Number));
    });

    it("writes nothing — and touches no TTL — for an empty link set", async () => {
      const { redis, hset, expire } = fakeRedis();
      const store = LangyResourceLinksRedisRepository.create({ redis });
      await store.remember({ conversationId: "conv-1", links: [] });

      expect(hset).not.toHaveBeenCalled();
      expect(expire).not.toHaveBeenCalled();
    });
  });
});
