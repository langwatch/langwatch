import { describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { EventSourcedQueueProcessorMemory } from "../memory";

type Payload = { id: string; value: string };

const settle = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The throttle contract the subscribers rely on has to hold on the in-memory
 * queue too, not only on the Redis one — memory mode is a supported
 * single-process deployment, and a window that silently does nothing there
 * would let every event through while the code reads as if it were throttled.
 *
 * These drive the queue itself rather than asserting on option objects: what
 * matters is which payloads the processor is actually handed, and when.
 */
describe("EventSourcedQueueProcessorMemory throttle window", () => {
  function createQueue({
    windowMs,
    ttlMs = windowMs,
    extend = false,
    shouldSurviveDispatch = false,
    concurrency = 5,
  }: {
    windowMs: number;
    ttlMs?: number;
    extend?: boolean;
    shouldSurviveDispatch?: boolean;
    concurrency?: number;
  }) {
    const processed: string[] = [];
    const queue = new EventSourcedQueueProcessorMemory<Payload>({
      name: "test-queue",
      process: async (payload) => {
        processed.push(payload.value);
      },
      delay: windowMs,
      deduplication: {
        makeId: (payload) => payload.id,
        ttlMs,
        extend,
        replace: true,
        shouldSurviveDispatch,
      },
      options: { concurrency },
    });
    return { queue, processed };
  }

  describe("given two sends sharing a dedup id inside the window", () => {
    describe("when the window elapses", () => {
      it("hands the processor only the latest payload", async () => {
        const { queue, processed } = createQueue({ windowMs: 60 });

        // Not awaited individually: a send settles when its job finishes, so
        // awaiting the first would close the window before the second lands.
        const sends = Promise.all([
          queue.send({ id: "same", value: "first" }),
          queue.send({ id: "same", value: "latest" }),
        ]);

        await settle(150);
        await sends;

        expect(processed).toEqual(["latest"]);
        await queue.close();
      });
    });
  });

  describe("given sends with different dedup ids", () => {
    it("keeps them as separate jobs", async () => {
      const { queue, processed } = createQueue({ windowMs: 40 });

      const sends = Promise.all([
        queue.send({ id: "a", value: "a" }),
        queue.send({ id: "b", value: "b" }),
      ]);

      await settle(140);
      await sends;

      expect(processed.sort()).toEqual(["a", "b"]);
      await queue.close();
    });
  });

  describe("given a job is still waiting out its window", () => {
    it("does not hold a concurrency slot while it waits", async () => {
      // One slot, one delayed job. An undelayed job sent afterwards must
      // still run: if the delayed one occupied the slot while sleeping it
      // would block everything behind it for the whole window.
      const processed: string[] = [];
      const queue = new EventSourcedQueueProcessorMemory<Payload>({
        name: "test-queue",
        process: async (payload) => {
          processed.push(payload.value);
        },
        options: { concurrency: 1 },
      });

      const delayed = queue
        .send({ id: "slow", value: "delayed" }, { delay: 200 })
        .catch(() => {
          // Rejected by close() below; the point is only that it never
          // blocked the slot.
        });
      await queue.send({ id: "fast", value: "immediate" });

      await settle(60);

      expect(processed).toEqual(["immediate"]);
      await queue.close();
      await delayed;
    });
  });

  describe("given the window is pinned rather than extending", () => {
    it("fires once even while sends keep arriving", async () => {
      // A stream arriving faster than the window must not defer its own job
      // forever. With extend off the deadline stays where the first send put
      // it, so the job lands mid-stream.
      const { queue, processed } = createQueue({ windowMs: 80 });

      const stream = (async () => {
        for (let i = 0; i < 8; i++) {
          await queue.send({ id: "same", value: `v${i}` });
          await settle(20);
        }
      })();

      await settle(140);
      expect(processed.length).toBeGreaterThan(0);

      await stream;
      await queue.close();
    });
  });

  describe("given a send arrives after its job dispatched", () => {
    describe("when the dedup id does not survive dispatch", () => {
      it("stages a genuinely new job", async () => {
        const { queue, processed } = createQueue({ windowMs: 30 });

        await queue.send({ id: "same", value: "first" });
        await settle(120);
        const second = queue.send({ id: "same", value: "second" });
        await settle(120);
        await second;

        expect(processed).toEqual(["first", "second"]);
        await queue.close();
      });
    });

    describe("when the dedup id survives dispatch", () => {
      it("discards the send for the rest of the ttl", async () => {
        // The suppression has to outlast the firing window for there to be
        // anything to suppress, which is exactly how the real caller sizes it.
        const { queue, processed } = createQueue({
          windowMs: 30,
          ttlMs: 500,
          shouldSurviveDispatch: true,
        });

        const first = queue.send({ id: "same", value: "first" });
        await settle(120);
        await first;

        await queue.send({ id: "same", value: "suppressed" });
        await settle(120);

        expect(processed).toEqual(["first"]);
        await queue.close();
      });
    });
  });

  describe("given the processor rejects", () => {
    it("rejects the send so the caller can retry the collapsed job", async () => {
      // The window leaves one job standing for a whole burst, so a swallowed
      // failure loses the burst rather than one attempt at it.
      const queue = new EventSourcedQueueProcessorMemory<Payload>({
        name: "test-queue",
        process: async () => {
          throw new Error("insert failed");
        },
        delay: 20,
        deduplication: { makeId: (payload) => payload.id, ttlMs: 20 },
      });

      await expect(queue.send({ id: "same", value: "only" })).rejects.toThrow(
        "insert failed",
      );

      await queue.close();
    });
  });
});
