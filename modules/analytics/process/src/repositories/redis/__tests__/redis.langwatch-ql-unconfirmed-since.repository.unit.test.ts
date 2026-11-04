import {
  memoryRedisDouble,
  memoryRedisStore,
} from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { RedisLwqlUnconfirmedSinceRepository } from "../redis.langwatch-ql-unconfirmed-since.repository.ts";

const KEY = "lwql:collection-unconfirmed-since";
const HOUR_MS = 60 * 60_000;

function clock() {
  const store = memoryRedisStore();
  const evals: unknown[][] = [];
  const redis = memoryRedisDouble({
    store,
    script: {
      // The double runs no Lua. This takes the mark script's steps against the
      // store, with no await between them, as Redis runs a script: in one step.
      eval: async (...args: unknown[]) => {
        evals.push(args);
        const [, , key, at, ttlMs] = args.map(String);
        const stored = store.strings.get(key!);
        const since = Number(stored);
        if (stored !== undefined && Number.isFinite(since) && since > 0) {
          store.expiries.set(key!, Number(ttlMs));
          return stored;
        }
        store.strings.set(key!, at!);
        store.expiries.set(key!, Number(ttlMs));
        return at;
      },
    },
  });
  return { store, evals, repository: RedisLwqlUnconfirmedSinceRepository.create({ redis }) };
}

describe("RedisLwqlUnconfirmedSinceRepository", () => {
  describe("given no failed check yet", () => {
    it("records the first failure's time, kept for an hour", async () => {
      const { store, repository } = clock();

      expect(await repository.mark(1_000)).toBe(1_000);
      expect(store.strings.get(KEY)).toBe("1000");
      expect(store.expiries.get(KEY)).toBe(HOUR_MS);
    });

    it("reads and writes the clock in one script call on its one key", async () => {
      const { evals, repository } = clock();

      await repository.mark(1_000);

      expect(evals).toHaveLength(1);
      expect(evals[0]!.slice(1)).toEqual([1, KEY, "1000", String(HOUR_MS)]);
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

    it("keeps the first of two checks delivered at once", async () => {
      const { store, repository } = clock();
      store.strings.set(KEY, "not-a-time");

      const [first, second] = await Promise.all([
        repository.mark(5_000),
        repository.mark(9_000),
      ]);

      expect([first, second]).toEqual([5_000, 5_000]);
      expect(store.strings.get(KEY)).toBe("5000");
    });
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
