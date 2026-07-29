import { describe, it, expect } from "vitest";
import { pMapLimited } from "../pMapLimited";

/**
 * Deferred promise handle — lets a test hold an in-flight invocation open
 * until it decides to resolve or reject it, so concurrency can be observed
 * deterministically without relying on timers.
 */
function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("pMapLimited", () => {
  describe("given more items than the concurrency limit", () => {
    describe("when mapping over them", () => {
      it("keeps in-flight invocations at or below the concurrency limit", async () => {
        const concurrency = 3;
        const items = Array.from({ length: 12 }, (_, i) => i);

        let inFlight = 0;
        let maxInFlight = 0;

        await pMapLimited({
          items,
          concurrency,
          fn: async () => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            // Yield so multiple invocations overlap before any settles.
            await Promise.resolve();
            await Promise.resolve();
            inFlight--;
          },
        });

        expect(maxInFlight).toBeLessThanOrEqual(concurrency);
        expect(maxInFlight).toBe(concurrency);
      });

      it("processes every item exactly once", async () => {
        const items = Array.from({ length: 25 }, (_, i) => i);
        const processed: number[] = [];

        await pMapLimited({
          items,
          concurrency: 4,
          fn: async (item) => {
            await Promise.resolve();
            processed.push(item);
          },
        });

        expect(processed).toHaveLength(items.length);
        expect([...processed].sort((a, b) => a - b)).toEqual(items);
      });
    });
  });

  describe("given one item that rejects", () => {
    describe("when mapping over the items", () => {
      it("rejects the whole call with that item's error", async () => {
        const items = [1, 2, 3, 4, 5];

        await expect(
          pMapLimited({
            items,
            concurrency: 2,
            fn: async (item) => {
              if (item === 3) throw new Error("boom on 3");
            },
          }),
        ).rejects.toThrow("boom on 3");
      });

      it("rejects even while other invocations are still in flight", async () => {
        const gate = deferred();
        const items = [0, 1];

        const result = pMapLimited({
          items,
          concurrency: 2,
          fn: async (item) => {
            if (item === 0) throw new Error("fail fast");
            // Item 1 stays in flight — the call must reject without waiting.
            await gate.promise;
          },
        });

        await expect(result).rejects.toThrow("fail fast");

        // Release the still-in-flight invocation so it does not leak.
        gate.resolve();
      });
    });
  });

  describe("given an empty items list", () => {
    describe("when mapping over it", () => {
      it("resolves immediately without invoking fn", async () => {
        let calls = 0;

        await expect(
          pMapLimited({
            items: [],
            concurrency: 5,
            fn: async () => {
              calls++;
            },
          }),
        ).resolves.toBeUndefined();

        expect(calls).toBe(0);
      });
    });
  });
});
