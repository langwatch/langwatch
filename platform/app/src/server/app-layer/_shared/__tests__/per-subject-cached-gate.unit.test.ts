/**
 * The shape ../authz/engine-gate.ts and ../identity/write-gate.ts delegate to.
 * Their own tests
 * already cover the per-gate TTL/fail-safe contract through the two public
 * gates; this suite covers the behaviours that live in the shared helper
 * itself and previously had no test anywhere: a read that throws is LOGGED,
 * concurrent asks for the same cold key share one read, and an invalidation
 * racing an in-flight read stops that read from caching what it resolves.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { perSubjectCachedFlag } from "../per-subject-cached-gate";

// The module under test calls `createLogger` once, at import time (the
// module-scope `const logger = createLogger(...)` every gate in this
// package uses) - the spy has to exist before that call runs, hence
// `vi.hoisted` (and `vi.mock`, itself hoisted above every import in this
// file by vitest) rather than setting it up inside a test.
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn }),
}));

describe("perSubjectCachedFlag", () => {
  afterEach(() => {
    warn.mockClear();
  });

  function gate(
    overrides?: Partial<Parameters<typeof perSubjectCachedFlag>[0]>,
  ) {
    return perSubjectCachedFlag({
      name: "test-gate",
      ttlMs: 60_000,
      ...overrides,
    });
  }

  describe("when two reads for the same cold organization race", () => {
    it("runs the read once and answers both callers", async () => {
      const flag = gate();
      let calls = 0;
      const read = () =>
        new Promise<boolean>((resolve) => {
          calls += 1;
          setTimeout(() => resolve(true), 5);
        });

      const [first, second] = await Promise.all([
        flag.get({ subject: "org-1", read }),
        flag.get({ subject: "org-1", read }),
      ]);

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(calls).toBe(1);
    });

    it("keeps two different organizations independent", async () => {
      const flag = gate();
      let calls = 0;
      const readFor = (value: boolean) => () => {
        calls += 1;
        return Promise.resolve(value);
      };

      const [org1, org2] = await Promise.all([
        flag.get({ subject: "org-1", read: readFor(true) }),
        flag.get({ subject: "org-2", read: readFor(false) }),
      ]);

      expect(org1).toBe(true);
      expect(org2).toBe(false);
      expect(calls).toBe(2);
    });
  });

  describe("when the read throws", () => {
    it("answers false rather than propagating the failure", async () => {
      const flag = gate();
      const result = await flag.get({
        subject: "org-1",
        read: () => Promise.reject(new Error("connection refused")),
      });
      expect(result).toBe(false);
    });

    it("logs a warning naming the organization, the gate and the error", async () => {
      const flag = gate();
      const error = new Error("connection refused");

      await flag.get({
        subject: "org-1",
        read: () => Promise.reject(error),
      });

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "org-1",
          gate: "test-gate",
          error,
        }),
        expect.any(String),
      );
    });

    it("caches the failure briefly rather than re-reading on the next ask", async () => {
      const flag = gate();
      let calls = 0;
      const read = () => {
        calls += 1;
        return Promise.reject(new Error("connection refused"));
      };

      await flag.get({ subject: "org-1", read });
      await flag.get({ subject: "org-1", read });

      expect(calls).toBe(1);
    });
  });

  describe("when invalidate runs while a read is in flight", () => {
    it("hands the in-flight callers the old answer but does not cache it, so the next read hits the source", async () => {
      const flag = gate();
      let resolveFirst: (value: boolean) => void = () => undefined;
      const first = flag.get({
        subject: "org-1",
        read: () =>
          new Promise<boolean>((resolve) => {
            resolveFirst = resolve;
          }),
      });

      flag.invalidate({ subject: "org-1" });
      resolveFirst(true);

      // The read had already begun when the invalidation landed, so its own
      // callers still get what it resolved - that is the coalescing contract.
      expect(await first).toBe(true);

      // But the stale answer was NOT cached: the next ask re-reads the
      // source and gets the post-invalidation value.
      let calls = 0;
      const second = await flag.get({
        subject: "org-1",
        read: () => {
          calls += 1;
          return Promise.resolve(false);
        },
      });
      expect(calls).toBe(1);
      expect(second).toBe(false);
    });

    it("drops the in-flight entry, so a reader arriving after the invalidation starts a fresh read rather than coalescing onto the stale one", async () => {
      const flag = gate();
      let resolveFirst: (value: boolean) => void = () => undefined;
      const first = flag.get({
        subject: "org-1",
        read: () =>
          new Promise<boolean>((resolve) => {
            resolveFirst = resolve;
          }),
      });

      flag.invalidate({ subject: "org-1" });

      // Still unresolved - yet the new reader must not share its promise.
      const second = await flag.get({
        subject: "org-1",
        read: () => Promise.resolve(false),
      });
      expect(second).toBe(false);

      resolveFirst(true);
      expect(await first).toBe(true);

      // And the fresh read's answer is what stayed cached: no re-read, and
      // the late settle of the stale flight did not overwrite it.
      let calls = 0;
      const third = await flag.get({
        subject: "org-1",
        read: () => {
          calls += 1;
          return Promise.resolve(true);
        },
      });
      expect(calls).toBe(0);
      expect(third).toBe(false);
    });

    it("drops an already-cached answer, so the very next read hits the source", async () => {
      const flag = gate();
      await flag.get({
        subject: "org-1",
        read: () => Promise.resolve(true),
      });

      flag.invalidate({ subject: "org-1" });

      let calls = 0;
      const result = await flag.get({
        subject: "org-1",
        read: () => {
          calls += 1;
          return Promise.resolve(false);
        },
      });
      expect(calls).toBe(1);
      expect(result).toBe(false);
    });
  });

  describe("when a gate is sized with its own maxEntries", () => {
    it("evicts the oldest subject at its own cap, not the default one", async () => {
      const flag = gate({ maxEntries: 2 });
      const readTrue = () => Promise.resolve(true);

      await flag.get({ subject: "user-1", read: readTrue });
      await flag.get({ subject: "user-2", read: readTrue });
      // The third subject crosses the cap: user-1, the oldest, is evicted.
      await flag.get({ subject: "user-3", read: readTrue });

      // The survivors stayed cached - the cap evicted the oldest entry,
      // not the whole map. Checked before touching user-1 again, because a
      // re-read of the evicted subject would itself evict at the cap.
      let cachedReads = 0;
      await flag.get({
        subject: "user-2",
        read: () => {
          cachedReads += 1;
          return Promise.resolve(true);
        },
      });
      await flag.get({
        subject: "user-3",
        read: () => {
          cachedReads += 1;
          return Promise.resolve(true);
        },
      });
      expect(cachedReads).toBe(0);

      let evictedReads = 0;
      await flag.get({
        subject: "user-1",
        read: () => {
          evictedReads += 1;
          return Promise.resolve(true);
        },
      });
      expect(evictedReads).toBe(1);
    });
  });

  describe("when resetForTesting runs", () => {
    it("drops both the cache and any in-flight bookkeeping", async () => {
      const flag = gate();
      await flag.get({
        subject: "org-1",
        read: () => Promise.resolve(true),
      });

      flag.resetForTesting();

      let calls = 0;
      await flag.get({
        subject: "org-1",
        read: () => {
          calls += 1;
          return Promise.resolve(true);
        },
      });
      expect(calls).toBe(1);
    });
  });
});
