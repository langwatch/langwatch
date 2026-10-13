import {
  MemorySharedCredentialStore,
  SharedCredentialPendingError,
  SharedCredentialUnreadableError,
  mintOnce,
  type SharedCredentialCipher,
} from "@langwatch/secrets/shared-credential";
/**
 * Mint once, share sealed: one claimant mints, every other caller reads its sealed value, and the
 * Redis layout keeps main's agent sandbox key readable.
 */
import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it, vi } from "vitest";

import { RedisSharedCredentialStore } from "../shared-credential.ts";

/** A reversible stand-in for the process's cipher; it refuses anything it did not seal. */
const cipher: SharedCredentialCipher = {
  encrypt: (plaintext) => `sealed:${Buffer.from(plaintext).toString("base64")}`,
  decrypt: (ciphertext) => {
    if (!ciphertext.startsWith("sealed:")) throw new Error("not sealed by this cipher");
    return Buffer.from(ciphertext.slice("sealed:".length), "base64").toString();
  },
};

const prefix = "ttlcache:agent-sandbox-key:";
const address = { tenantId: "project-1" };

/** One Redis every server reaches; a claim is released only while its own token holds it. */
function sharedRedis() {
  const store = memoryRedisStore();
  const keyspace = memoryRedisDouble({ store });
  const releaseIfOwned = async (_script: unknown, _keys: unknown, key: unknown, token: unknown) =>
    (await keyspace.get(String(key))) === token ? keyspace.del(String(key)) : 0;
  const server = () =>
    RedisSharedCredentialStore.create({
      redis: memoryRedisDouble({ store, script: { eval: releaseIfOwned } }),
      cipher,
      prefix,
    });
  return { keyspace, server };
}

describe("RedisSharedCredentialStore", () => {
  describe("when a value is held", () => {
    it("rests sealed under the prefix and tenant for the window, and opens back", async () => {
      const { keyspace, server } = sharedRedis();
      const held = server();

      await held.hold({ address, value: "content-marker", ttlMs: 8 * 3_600_000 });

      const stored = `${prefix}project-1`;
      expect(await keyspace.get(stored)).toBe(JSON.stringify(cipher.encrypt("content-marker")));
      expect(await keyspace.ttl(stored)).toBe(8 * 3_600);
      await expect(held.find(address)).resolves.toEqual(["content-marker"]);
    });

    it("keeps values of one tenant apart by content", async () => {
      const { keyspace, server } = sharedRedis();
      const held = server();

      await held.hold({ address: { ...address, contentKey: "a" }, value: "one", ttlMs: 60_000 });

      expect(await keyspace.get(`${prefix}project-1:a`)).not.toBeNull();
      await expect(held.find({ ...address, contentKey: "b" })).resolves.toEqual([]);
      await expect(held.find(address)).resolves.toEqual([]);
    });

    it("drops the value when forgotten", async () => {
      const held = sharedRedis().server();
      await held.hold({ address, value: "content-marker", ttlMs: 60_000 });

      await held.forget(address);

      await expect(held.find(address)).resolves.toEqual([]);
    });
  });

  describe("when the held value cannot be opened", () => {
    it("refuses with the unreadable error rather than answering it", async () => {
      const { keyspace, server } = sharedRedis();
      await keyspace.set(`${prefix}project-1`, JSON.stringify("damaged"));

      await expect(server().find(address)).rejects.toBeInstanceOf(SharedCredentialUnreadableError);
    });
  });

  describe("when two servers claim one address", () => {
    it("lets one win, and frees it only on the winner's release", async () => {
      const { server } = sharedRedis();
      const one = server();
      const other = server();

      const [won] = await one.claim({ address, ttlMs: 30_000 });
      await expect(other.claim({ address, ttlMs: 30_000 })).resolves.toEqual([]);
      await other.release({ address, claim: { token: "not-the-winner" } });
      await expect(other.claim({ address, ttlMs: 30_000 })).resolves.toEqual([]);

      if (won) await one.release({ address, claim: won });
      await expect(other.claim({ address, ttlMs: 30_000 })).resolves.toHaveLength(1);
    });
  });
});

describe("mintOnce", () => {
  describe("when two servers ask at once", () => {
    it("mints once and hands both the same value", async () => {
      const { server } = sharedRedis();
      const mint = vi.fn(async () => ({ value: "token-1", ttlMs: 60_000 }));

      const values = await Promise.all([
        mintOnce({ store: server(), address, pollMs: 5, mint }),
        mintOnce({ store: server(), address, pollMs: 5, mint }),
      ]);

      expect(values).toEqual(["token-1", "token-1"]);
      expect(mint).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a ready value is held", () => {
    it("answers it without minting", async () => {
      const store = MemorySharedCredentialStore.create();
      await store.hold({ address, value: "token-1", ttlMs: 60_000 });
      const mint = vi.fn(async () => ({ value: "token-2", ttlMs: 60_000 }));

      await expect(mintOnce({ store, address, mint })).resolves.toBe("token-1");
      expect(mint).not.toHaveBeenCalled();
    });
  });

  describe("when the held value is not ready", () => {
    it("hands it to the next claimant's mint, which resumes it", async () => {
      const store = MemorySharedCredentialStore.create();
      await store.hold({ address, value: "pending:key-1", ttlMs: 60_000 });

      const value = await mintOnce({
        store,
        address,
        isReady: (held) => held.startsWith("active:"),
        mint: async ({ earlier }) => ({
          value: earlier[0]?.replace("pending:", "active:") ?? "active:key-2",
          ttlMs: 60_000,
        }),
      });

      expect(value).toBe("active:key-1");
      await expect(store.find(address)).resolves.toEqual(["active:key-1"]);
    });
  });

  describe("when a mint fails", () => {
    it("keeps what it shared before failing and frees the claim for the next caller", async () => {
      const store = MemorySharedCredentialStore.create();
      const isReady = (held: string) => held.startsWith("active:");

      await expect(
        mintOnce({
          store,
          address,
          isReady,
          mint: async ({ hold }) => {
            await hold({ value: "pending:key-1", ttlMs: 60_000 });
            throw new Error("the grant has not landed");
          },
        }),
      ).rejects.toThrow("the grant has not landed");

      const retried = await mintOnce({
        store,
        address,
        isReady,
        mint: async ({ earlier }) => ({ value: `active:${earlier.join()}`, ttlMs: 60_000 }),
      });
      expect(retried).toBe("active:pending:key-1");
    });
  });

  describe("when another caller holds the claim past the wait", () => {
    it("answers pending rather than minting a second value", async () => {
      const store = MemorySharedCredentialStore.create();
      await store.claim({ address, ttlMs: 30_000 });
      const mint = vi.fn(async () => ({ value: "token-2", ttlMs: 60_000 }));

      await expect(
        mintOnce({ store, address, waitMs: 20, pollMs: 5, mint }),
      ).rejects.toBeInstanceOf(SharedCredentialPendingError);
      expect(mint).not.toHaveBeenCalled();
    });
  });

  describe("when the held value cannot be opened", () => {
    it("says so and mints a value that replaces it", async () => {
      const { keyspace, server } = sharedRedis();
      await keyspace.set(`${prefix}project-1`, JSON.stringify("damaged"));
      const onUnreadable = vi.fn();
      const store = server();

      const value = await mintOnce({
        store,
        address,
        onUnreadable,
        mint: async () => ({ value: "token-1", ttlMs: 60_000 }),
      });

      expect(value).toBe("token-1");
      expect(onUnreadable).toHaveBeenCalledTimes(1);
      await expect(store.find(address)).resolves.toEqual(["token-1"]);
    });
  });
});
