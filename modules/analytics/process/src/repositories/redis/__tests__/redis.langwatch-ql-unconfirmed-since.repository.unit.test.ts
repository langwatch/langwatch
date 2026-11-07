import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { RedisLwqlUnconfirmedSinceRepository } from "../redis.langwatch-ql-unconfirmed-since.repository.ts";

const KEY = "lwql:collection-unconfirmed-since";
const HOUR_MS = 60 * 60_000;

function clock() {
  const store = memoryRedisStore();
  const redis = memoryRedisDouble({ store });
  return { store, repository: RedisLwqlUnconfirmedSinceRepository.create({ redis }) };
}

describe("RedisLwqlUnconfirmedSinceRepository", () => {
  describe("given no failed check yet", () => {
    it("records the first failure's time, kept for an hour", async () => {
      const { store, repository } = clock();

      expect(await repository.mark(1_000)).toBe(1_000);
      expect(store.strings.get(KEY)).toBe("1000");
      expect(store.expiries.get(KEY)).toBe(HOUR_MS);
    });
  });

  describe("given a failure already recorded", () => {
    it("keeps the first time on a later failure", async () => {
      const { repository } = clock();
      await repository.mark(1_000);

      expect(await repository.mark(5_000)).toBe(1_000);
    });

    it("extends the hour on each later failure", async () => {
      const { store, repository } = clock();
      await repository.mark(1_000);
      store.expiries.set(KEY, 10);

      await repository.mark(5_000);

      expect(store.expiries.get(KEY)).toBe(HOUR_MS);
    });
  });

  describe("given a stored value that is not a time", () => {
    /** @scenario "A collection that stays unconfirmed alerts 15 minutes after the first failed check" */
    it.each(["not-a-time", "0", "-1"])(
      "falls back to the failure's own time over %s, and stores it for an hour",
      async (stored) => {
        const { store, repository } = clock();
        store.strings.set(KEY, stored);

        expect(await repository.mark(5_000)).toBe(5_000);
        expect(store.strings.get(KEY)).toBe("5000");
        expect(store.expiries.get(KEY)).toBe(HOUR_MS);
        expect(await repository.mark(9_000)).toBe(5_000);
      },
    );
  });

  describe("given a converged check", () => {
    it("clears the clock, so the next failure starts a new one", async () => {
      const { store, repository } = clock();
      await repository.mark(1_000);

      await repository.clear();

      expect(store.strings.has(KEY)).toBe(false);
      expect(await repository.mark(9_000)).toBe(9_000);
    });
  });
});
