import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable Redis "connection" state. QueueWithFallback reads `connection` from
// the redis module to decide between its enqueue path (connection present) and
// its inline-fallback short-circuit (no connection). A getter keeps the binding
// live so each test can flip it.
const redisState = vi.hoisted(() => ({
  connection: undefined as Record<string, unknown> | undefined,
}));
vi.mock("../../../redis", () => ({
  get connection() {
    return redisState.connection;
  },
}));

// Stub BullMQ's Queue/Job so we never touch a real Redis. `enqueue` stands in
// for the inner `Queue.add` that QueueWithFallback wraps — tests drive it to
// reject to simulate BullMQ rejecting the job (e.g. the ":"-in-jobId rejection
// that caused the incident). Everything else (telemetry, etc.) stays real.
const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bullmq")>();
  class Queue {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
    add(...args: unknown[]) {
      return enqueue(...args);
    }
  }
  class Job {
    constructor(
      public queue: unknown,
      public name: string,
      public data: unknown,
      public opts: unknown,
    ) {}
  }
  return { ...actual, Queue, Job };
});

import { QueueWithFallback } from "../queueWithFallback";

const buildQueue = (
  worker: () => Promise<unknown>,
  behavior?: { fallbackToInline?: boolean },
) =>
  new QueueWithFallback<{ x: number }, string, string>(
    "q",
    worker,
    undefined,
    behavior,
  );

describe("QueueWithFallback inline-fallback gating", () => {
  afterEach(() => {
    enqueue.mockReset();
  });

  describe("given the queue has no Redis connection", () => {
    beforeEach(() => {
      redisState.connection = undefined;
    });

    describe("when inline fallback is enabled (default)", () => {
      it("runs the worker inline and returns its result", async () => {
        const worker = vi.fn().mockResolvedValue("done");

        const result = await buildQueue(worker).add("job", { x: 1 });

        expect(worker).toHaveBeenCalledTimes(1);
        expect(result).toBe("done");
        expect(enqueue).not.toHaveBeenCalled();
      });
    });

    describe("when inline fallback is disabled", () => {
      it("throws and never runs the worker", async () => {
        const worker = vi.fn().mockResolvedValue("done");
        const queue = buildQueue(worker, { fallbackToInline: false });

        await expect(queue.add("job", { x: 1 })).rejects.toThrow();
        expect(worker).not.toHaveBeenCalled();
      });
    });
  });

  // The prod incident path: Redis WAS available, but BullMQ rejected the add
  // because the jobId contained ":". The wrapper's catch branch then ran the
  // heavy worker inline once per ingestion event. These cases lock that branch.
  describe("given the queue has a Redis connection but the enqueue fails", () => {
    beforeEach(() => {
      // Fake-timer the 3s enqueue-timeout race so the rejection resolves via
      // microtasks and no real timer lingers past the (instant) test.
      vi.useFakeTimers();
      redisState.connection = {};
      enqueue.mockRejectedValue(new Error("Custom Id cannot contain :"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe("when inline fallback is enabled (default)", () => {
      it("falls back to running the worker inline", async () => {
        const worker = vi.fn().mockResolvedValue("done");

        const result = await buildQueue(worker).add("job", { x: 1 });

        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(worker).toHaveBeenCalledTimes(1);
        expect(result).toBe("done");
      });
    });

    describe("when inline fallback is disabled", () => {
      it("rethrows the enqueue error and never runs the worker inline", async () => {
        const worker = vi.fn().mockResolvedValue("done");
        const queue = buildQueue(worker, { fallbackToInline: false });

        await expect(queue.add("job", { x: 1 })).rejects.toThrow(
          "Custom Id cannot contain :",
        );
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(worker).not.toHaveBeenCalled();
      });
    });
  });
});
