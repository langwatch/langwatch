import { describe, expect, it } from "vitest";

import { MemoryBetterAuthMapSecondaryStorageRepository } from "../memory.better-auth-map-secondary-storage.repository.ts";

function storage() {
  const clock = { now: 0 };
  return {
    clock,
    storage: MemoryBetterAuthMapSecondaryStorageRepository.create({ now: () => clock.now }),
  };
}

describe("MemoryBetterAuthMapSecondaryStorageRepository", () => {
  describe("given a session key written with a TTL", () => {
    describe("when it is read before the TTL runs out", () => {
      it("keeps the value", async () => {
        const { clock, storage: store } = storage();
        await store.set("session-token", '{"session":"s1"}', 2);

        clock.now += 1_999;

        await expect(store.get("session-token")).resolves.toBe('{"session":"s1"}');
      });
    });

    describe("when it is read once the TTL has run out", () => {
      it("answers nothing", async () => {
        const { clock, storage: store } = storage();
        await store.set("session-token", '{"session":"s1"}', 2);

        clock.now += 2_000;

        await expect(store.get("session-token")).resolves.toBeNull();
        await expect(store.getAndDelete("session-token")).resolves.toBeNull();
      });
    });

    describe("when the session is revoked", () => {
      it("answers nothing afterwards", async () => {
        const { storage: store } = storage();
        await store.set("session-token", "value", 60);

        await store.delete("session-token");

        await expect(store.get("session-token")).resolves.toBeNull();
      });
    });
  });

  describe("given a value written with no time left", () => {
    it("deletes rather than keeping it bare, as the Redis twin does", async () => {
      const { storage: store } = storage();
      await store.set("key", "old", 60);

      await store.set("key", "new");

      await expect(store.get("key")).resolves.toBeNull();
    });
  });

  describe("given a single-use value", () => {
    it("hands it to the first reader only", async () => {
      const { storage: store } = storage();
      await store.set("once", "value", 60);

      await expect(store.getAndDelete("once")).resolves.toBe("value");
      await expect(store.getAndDelete("once")).resolves.toBeNull();
    });
  });

  describe("given a rate-limit counter", () => {
    it("counts within its window and starts again once the window closes", async () => {
      const { clock, storage: store } = storage();

      await expect(store.increment("attempts", 10)).resolves.toBe(1);
      clock.now += 9_000;
      await expect(store.increment("attempts", 10)).resolves.toBe(2);
      clock.now += 1_000;

      await expect(store.increment("attempts", 10)).resolves.toBe(1);
    });
  });
});
