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
  describe("given an invalid concurrency limit", () => {
    describe("when the limiter is built", () => {
      it.each([0, -1, 2.5])("refuses to be built with %s", (maxConcurrent) => {
        expect(() => createConcurrencyLimiter({ maxConcurrent })).toThrow(
          RangeError,
        );
      });
    });
  });

  describe("given an invalid queue bound", () => {
    describe("when the limiter is built", () => {
      it.each([
        -1,
        2.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ])("refuses to be built with %s", (maxQueued) => {
        // `waiting.length >= NaN` is false forever, so an unvalidated NaN
        // unbounds the queue and removes the only thing this module is for.
        expect(() =>
          createConcurrencyLimiter({ maxConcurrent: 1, maxQueued }),
        ).toThrow(RangeError);
      });
    });
  });

  describe("given a queue bound of zero", () => {
    describe("when the slots are all taken", () => {
      it("sheds without waiting, which is a real configuration", async () => {
        // Zero is the boundary between valid and invalid, and it means
        // something deliberate: never queue, refuse the moment the slots go.
        const limiter = createConcurrencyLimiter({
          maxConcurrent: 1,
          maxQueued: 0,
        });
        const gate = deferred();

        void limiter.run(() => gate.promise);

        await expect(limiter.run(async () => "second")).rejects.toBeInstanceOf(
          QueueFullError,
        );
        gate.resolve();
      });
    });
  });

  describe("given more work than the limit allows", () => {
    describe("when the tasks are submitted", () => {
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
    });

    describe("when a slot frees", () => {
      it("admits the next waiter", async () => {
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
  });

  describe("given a task that fails", () => {
    describe("when the failure propagates", () => {
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
  });

  describe("given the wait queue is full", () => {
    describe("when another caller arrives", () => {
      it("sheds immediately rather than queueing without bound", async () => {
        // An unbounded queue does not prevent overload, it hides it: the
        // server stays inside its limit while latency and memory climb.
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
  });

  describe("given a caller that aborts", () => {
    describe("when it aborts while waiting", () => {
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
    });

    describe("when it has already aborted before arriving", () => {
      it("refuses it without taking a slot", async () => {
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
});

describe("rateLimit middleware", () => {
  describe("given a statement", () => {
    describe("when it is executed", () => {
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
});
