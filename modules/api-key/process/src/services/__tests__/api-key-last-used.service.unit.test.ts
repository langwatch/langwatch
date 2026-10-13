import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import {
  API_KEY_LAST_USED_MAX_HOLDS,
  API_KEY_LAST_USED_WINDOW_MS,
  ApiKeyLastUsedService,
} from "../api-key-last-used.service.ts";

function usageWith({ fail = () => false }: { fail?: () => boolean } = {}) {
  let nowMs = 1_700_000_000_000;
  const updateLastUsedAt = vi.fn(async (_input: { id: string }) => {
    if (fail()) throw new Error("database unavailable");
  });
  const usage = ApiKeyLastUsedService.create({
    repository: { updateLastUsedAt },
    now: () => Temporal.Instant.fromEpochMilliseconds(nowMs),
  });

  return {
    usage,
    updateLastUsedAt,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ApiKeyLastUsedService.markUsed", () => {
  describe("given a key used 100 times within one minute", () => {
    /** @scenario "Last used is written at most once a minute per key per process" */
    it("writes its last-used time once", () => {
      const { usage, updateLastUsedAt, advance } = usageWith();

      for (let use = 0; use < 100; use++) {
        usage.markUsed({ id: "key-1" });
        advance(500);
      }

      expect(updateLastUsedAt).toHaveBeenCalledTimes(1);
      expect(updateLastUsedAt).toHaveBeenCalledWith({ id: "key-1" });
    });

    /** @scenario "Last used is written at most once a minute per key per process" */
    it("writes again on the first use after the minute", () => {
      const { usage, updateLastUsedAt, advance } = usageWith();

      usage.markUsed({ id: "key-1" });
      advance(API_KEY_LAST_USED_WINDOW_MS - 1);
      usage.markUsed({ id: "key-1" });
      advance(1);
      usage.markUsed({ id: "key-1" });

      expect(updateLastUsedAt).toHaveBeenCalledTimes(2);
    });

    it("holds each key on its own", () => {
      const { usage, updateLastUsedAt } = usageWith();

      usage.markUsed({ id: "key-1" });
      usage.markUsed({ id: "key-2" });
      usage.markUsed({ id: "key-1" });

      expect(updateLastUsedAt.mock.calls).toEqual([[{ id: "key-1" }], [{ id: "key-2" }]]);
    });
  });

  describe("given as many keys held as the ceiling allows", () => {
    function full() {
      const world = usageWith();
      for (let key = 0; key < API_KEY_LAST_USED_MAX_HOLDS; key++) {
        world.usage.markUsed({ id: `key-${key}` });
      }
      world.updateLastUsedAt.mockClear();
      return world;
    }

    it("lets a new key in by dropping the oldest hold, and only that one", () => {
      const { usage, updateLastUsedAt } = full();

      usage.markUsed({ id: "key-new" });
      usage.markUsed({ id: "key-1" });
      usage.markUsed({ id: "key-0" });

      expect(updateLastUsedAt.mock.calls).toEqual([[{ id: "key-new" }], [{ id: "key-0" }]]);
    });

    it("never walks the held keys, however hot one key runs", () => {
      const { usage, advance } = full();
      const walks = [
        vi.spyOn(Map.prototype, Symbol.iterator),
        vi.spyOn(Map.prototype, "forEach"),
        vi.spyOn(Map.prototype, "values"),
      ];
      const peeks = [vi.spyOn(Map.prototype, "entries"), vi.spyOn(Map.prototype, "keys")];

      for (let use = 0; use < 100; use++) {
        usage.markUsed({ id: "key-hot" });
        advance(100);
      }
      const walked = walks.map((spy) => spy.mock.calls.length);
      const peeked = peeks.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
      for (const spy of [...walks, ...peeks]) spy.mockRestore();

      expect(walked).toEqual([0, 0, 0]);
      expect(peeked).toBeLessThanOrEqual(100 * 3);
    });
  });

  describe("when the write fails", () => {
    /** @scenario "Last used is written at most once a minute per key per process" */
    it("lets the next use try again", async () => {
      let failing = true;
      const { usage, updateLastUsedAt } = usageWith({ fail: () => failing });

      usage.markUsed({ id: "key-1" });
      await settle();
      failing = false;
      usage.markUsed({ id: "key-1" });
      await settle();
      usage.markUsed({ id: "key-1" });

      expect(updateLastUsedAt).toHaveBeenCalledTimes(2);
    });
  });
});
