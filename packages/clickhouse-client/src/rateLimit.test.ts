import { describe, expect, it, vi } from "vitest";
import {
  AcquireAbortedError,
  createConcurrencyLimiter,
  QueueFullError,
  rateLimit,
} from "./rateLimit";

/** A task whose completion the test controls. */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("createConcurrencyLimiter", () => {
  describe("given an invalid limit", () => {
    it.each([0, -1, 2.5])("refuses to be built with %s", (maxConcurrent) => {
      expect(() => createConcurrencyLimiter({ maxConcurrent })).toThrow(
        RangeError,
      );
    });
  });

  describe("given more work than the limit allows", () => {
    it("runs only up to the limit at once", async () => {
      const limiter = createConcurrencyLimiter({ maxConcurrent: 2 });
      const gates = [deferred(), deferred(), deferred()];
      const started = [false, false, false];

      gates.forEach((gate, i) => {
        void limiter.run(async () => {
          started[i] = true;
          await gate.promise;
        });
      });
      await Promise.resolve();

      expect(started).toEqual([true, true, false]);
      expect(limiter.stats()).toEqual({ inFlight: 2, queued: 1 });
    });

    it("admits the next waiter when a slot frees", async () => {
      const limiter = createConcurrencyLimiter({ maxConcurrent: 1 });
      const first = deferred();
      let secondStarted = false;

      void limiter.run(() => first.promise);
      const second = limiter.run(async () => {
        secondStarted = true;
      });
      await Promise.resolve();
      expect(secondStarted).toBe(false);

      first.resolve();
      await second;

      expect(secondStarted).toBe(true);
    });
  });

  describe("given a task that fails", () => {
    it("still releases the slot", async () => {
      const limiter = createConcurrencyLimiter({ maxConcurrent: 1 });

      await expect(
        limiter.run(async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      expect(limiter.stats().inFlight).toBe(0);
      await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
    });
  });

  describe("given the wait queue is full", () => {
    it("sheds immediately rather than queueing without bound", async () => {
      // An unbounded queue does not prevent overload, it hides it: the server
      // stays inside its limit while latency and memory climb.
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 1,
        maxQueued: 1,
      });
      const gate = deferred();

      void limiter.run(() => gate.promise);
      void limiter.run(() => gate.promise);

      await expect(limiter.run(async () => "third")).rejects.toBeInstanceOf(
        QueueFullError,
      );
      gate.resolve();
    });
  });

  describe("given a caller that aborts while waiting", () => {
    it("gives up its place instead of occupying the queue", async () => {
      const limiter = createConcurrencyLimiter({ maxConcurrent: 1 });
      const gate = deferred();
      const controller = new AbortController();

      void limiter.run(() => gate.promise);
      const waiting = limiter.run(async () => "never", controller.signal);
      await Promise.resolve();
      expect(limiter.stats().queued).toBe(1);

      controller.abort();

      await expect(waiting).rejects.toBeInstanceOf(AcquireAbortedError);
      expect(limiter.stats().queued).toBe(0);
      gate.resolve();
    });

    it("refuses an already-aborted caller without taking a slot", async () => {
      const limiter = createConcurrencyLimiter({ maxConcurrent: 1 });
      const controller = new AbortController();
      controller.abort();

      await expect(
        limiter.run(async () => "never", controller.signal),
      ).rejects.toBeInstanceOf(AcquireAbortedError);
      expect(limiter.stats().inFlight).toBe(0);
    });
  });
});

describe("rateLimit middleware", () => {
  describe("given a statement", () => {
    it("runs it through the limiter", async () => {
      const limiter = createConcurrencyLimiter({ maxConcurrent: 1 });
      const next = vi.fn(async () => ({ rows: [1] }));

      const result = await rateLimit({ limiter })(next as never)({
        tenantId: "project_1",
        sql: "SELECT 1",
      });

      expect(result.rows).toEqual([1]);
      expect(limiter.stats().inFlight).toBe(0);
    });
  });
});
