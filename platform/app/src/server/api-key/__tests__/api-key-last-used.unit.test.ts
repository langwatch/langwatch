import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import type { RoleRepository } from "~/server/role/repositories/role.repository";
import type { ApiKeyRepository } from "../api-key.repository";
import { ApiKeyService } from "../api-key.service";
import {
  API_KEY_LAST_USED_WINDOW_MS,
  ApiKeyLastUsedRecorder,
  MAX_API_KEY_LAST_USED_HOLDS,
} from "../api-key-last-used";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeRecorder() {
  let clock = 1_000_000;
  const recorder = new ApiKeyLastUsedRecorder({ now: () => clock });
  return {
    recorder,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ApiKeyLastUsedRecorder", () => {
  describe("given a key used 100 times within one minute", () => {
    /** @scenario Last used is written at most once a minute per key per process */
    it("writes its last-used time once", () => {
      const { recorder, advance } = makeRecorder();
      const write = vi.fn().mockResolvedValue(undefined);

      for (let use = 0; use < 100; use += 1) {
        recorder.markUsed({ id: "key-1", write });
        advance(500);
      }

      expect(write).toHaveBeenCalledTimes(1);
    });

    /** @scenario Last used is written at most once a minute per key per process */
    it("writes again on a use after the minute", () => {
      const { recorder, advance } = makeRecorder();
      const write = vi.fn().mockResolvedValue(undefined);

      recorder.markUsed({ id: "key-1", write });
      advance(API_KEY_LAST_USED_WINDOW_MS - 1);
      recorder.markUsed({ id: "key-1", write });
      expect(write).toHaveBeenCalledTimes(1);

      advance(1);
      recorder.markUsed({ id: "key-1", write });
      expect(write).toHaveBeenCalledTimes(2);
    });

    it("holds each key on its own", () => {
      const { recorder } = makeRecorder();
      const write = vi.fn().mockResolvedValue(undefined);

      recorder.markUsed({ id: "key-1", write });
      recorder.markUsed({ id: "key-2", write });
      recorder.markUsed({ id: "key-1", write });

      expect(write).toHaveBeenCalledTimes(2);
    });
  });

  describe("given the most keys it holds at once", () => {
    /** Counts the entries any large Map yields while `run` executes. */
    function entriesVisited(run: () => void): number {
      const iterate = Map.prototype[Symbol.iterator];
      let visited = 0;
      const spy = vi
        .spyOn(Map.prototype, Symbol.iterator)
        .mockImplementation(function (this: Map<unknown, unknown>) {
          const entries = iterate.call(this);
          if (this.size < 1_000) return entries;
          const next = entries.next.bind(entries);
          return Object.assign(entries, {
            next: () => {
              visited += 1;
              return next();
            },
          });
        });
      try {
        run();
      } finally {
        spy.mockRestore();
      }
      return visited;
    }

    function holdTenThousand() {
      const clock = makeRecorder();
      const write = vi.fn().mockResolvedValue(undefined);
      for (let key = 0; key < MAX_API_KEY_LAST_USED_HOLDS; key += 1) {
        clock.recorder.markUsed({ id: `key-${key}`, write });
      }
      return { ...clock, write };
    }

    it("serves a hot key without walking the holds", () => {
      const { recorder, write } = holdTenThousand();

      const visited = entriesVisited(() => {
        for (let use = 0; use < 100; use += 1) {
          recorder.markUsed({ id: "key-0", write });
        }
      });

      expect(visited).toBe(0);
      expect(write).toHaveBeenCalledTimes(MAX_API_KEY_LAST_USED_HOLDS);
    });

    it("evicts the oldest hold to admit a new key, and only that one", () => {
      const { recorder, write } = holdTenThousand();

      recorder.markUsed({ id: "key-new", write });
      recorder.markUsed({ id: "key-0", write });
      recorder.markUsed({ id: "key-2", write });

      // key-new evicted key-0, whose next use writes and evicts key-1; key-2
      // is still held.
      expect(write).toHaveBeenCalledTimes(MAX_API_KEY_LAST_USED_HOLDS + 2);
    });

    it("admits a new key without walking the holds", () => {
      const { recorder, write } = holdTenThousand();

      const visited = entriesVisited(() => {
        recorder.markUsed({ id: "key-new", write });
      });

      expect(visited).toBeLessThanOrEqual(1);
    });

    it("drops every expired hold once the window has passed", () => {
      const { recorder, advance, write } = holdTenThousand();
      advance(API_KEY_LAST_USED_WINDOW_MS);
      recorder.markUsed({ id: "key-new", write });

      // Every earlier hold went with that write, so none is evicted to admit
      // the next key and key-new is still held.
      recorder.markUsed({ id: "key-newer", write });
      recorder.markUsed({ id: "key-new", write });
      expect(write).toHaveBeenCalledTimes(MAX_API_KEY_LAST_USED_HOLDS + 2);
    });
  });

  describe("when a write fails", () => {
    /** @scenario Last used is written at most once a minute per key per process */
    it("lets the next use try again", async () => {
      const { recorder } = makeRecorder();
      const write = vi
        .fn()
        .mockRejectedValueOnce(new Error("database unavailable"))
        .mockResolvedValue(undefined);

      recorder.markUsed({ id: "key-1", write });
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      recorder.markUsed({ id: "key-1", write });

      expect(write).toHaveBeenCalledTimes(2);
    });
  });
});

describe("ApiKeyService.markUsed", () => {
  describe("given a service built per request", () => {
    /** @scenario Last used is written at most once a minute per key per process */
    it("shares one hold across every instance in the process", () => {
      const updateLastUsedAt = vi.fn().mockResolvedValue(undefined);
      const build = () =>
        new ApiKeyService({
          prisma: {} as PrismaClient,
          repo: { updateLastUsedAt } as unknown as ApiKeyRepository,
          roleRepo: {} as RoleRepository,
        });
      const id = `key-${Math.random()}`;

      build().markUsed({ id });
      build().markUsed({ id });

      expect(updateLastUsedAt).toHaveBeenCalledTimes(1);
      expect(updateLastUsedAt).toHaveBeenCalledWith({ id });
    });
  });
});
