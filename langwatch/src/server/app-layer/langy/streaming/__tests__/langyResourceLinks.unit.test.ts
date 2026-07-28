/**
 * The resource-link store is Langy's per-CONVERSATION memory of which platform
 * address a lookup surfaced for a resource — the only thing a later
 * `langwatch navigate open <id>` may resolve an address from. These pin the
 * Redis shape choices: one hash per conversation (so conversations can never
 * read each other's links) and a TTL refreshed on every write (so an active
 * conversation's links never lapse mid-session).
 */
import { describe, expect, it, vi } from "vitest";
import {
  createLangyResourceLinkStore,
  type LangyLinkRedis,
} from "../langyResourceLinks";

function fakeRedis() {
  const hashes = new Map<string, Map<string, string>>();
  const redis = {
    hset: vi.fn(async (key: string, field: string, value: string) => {
      const hash = hashes.get(key) ?? new Map<string, string>();
      const added = hash.has(field) ? 0 : 1;
      hash.set(field, value);
      hashes.set(key, hash);
      return added;
    }),
    hget: vi.fn(
      async (key: string, field: string) =>
        hashes.get(key)?.get(field) ?? null,
    ),
    expire: vi.fn(async () => 1),
  } satisfies LangyLinkRedis;
  return { redis, hashes };
}

describe("langyResourceLinkStore", () => {
  describe("when a lookup surfaces links and a later turn resolves them", () => {
    it("resolves every id a remembered link was keyed under", async () => {
      const { redis } = fakeRedis();
      const store = createLangyResourceLinkStore({ redis });
      const href = "https://app.langwatch.ai/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1";
      await store.remember({
        conversationId: "conv-1",
        links: [
          { id: "batch_1", href },
          { id: "run_1", href },
        ],
      });

      expect(await store.resolve({ conversationId: "conv-1", id: "batch_1" })).toBe(href);
      expect(await store.resolve({ conversationId: "conv-1", id: "run_1" })).toBe(href);
    });

    it("returns null for a resource this conversation never surfaced", async () => {
      const { redis } = fakeRedis();
      const store = createLangyResourceLinkStore({ redis });

      expect(
        await store.resolve({ conversationId: "conv-1", id: "unknown" }),
      ).toBeNull();
    });
  });

  describe("when two conversations remember the same resource id", () => {
    it("keeps each conversation's links invisible to the other", async () => {
      const { redis } = fakeRedis();
      const store = createLangyResourceLinkStore({ redis });
      await store.remember({
        conversationId: "conv-1",
        links: [{ id: "run_1", href: "https://app.langwatch.ai/a/x" }],
      });

      expect(
        await store.resolve({ conversationId: "conv-2", id: "run_1" }),
      ).toBeNull();
    });
  });

  describe("when links are written", () => {
    it("refreshes the conversation key's TTL on every write", async () => {
      const { redis } = fakeRedis();
      const store = createLangyResourceLinkStore({ redis });
      await store.remember({
        conversationId: "conv-1",
        links: [{ id: "run_1", href: "https://app.langwatch.ai/a/x" }],
      });
      await store.remember({
        conversationId: "conv-1",
        links: [{ id: "run_2", href: "https://app.langwatch.ai/a/y" }],
      });

      expect(redis.expire).toHaveBeenCalledTimes(2);
      expect(redis.expire).toHaveBeenCalledWith(
        "langy:navlink:conv-1",
        expect.any(Number),
      );
    });

    it("writes nothing — and touches no TTL — for an empty link set", async () => {
      const { redis } = fakeRedis();
      const store = createLangyResourceLinkStore({ redis });
      await store.remember({ conversationId: "conv-1", links: [] });

      expect(redis.hset).not.toHaveBeenCalled();
      expect(redis.expire).not.toHaveBeenCalled();
    });
  });
});
