import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventSourcedQueueDefinition } from "../../queues";

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

import { EventSourcedQueueProcessorMemory } from "../memory";

describe("EventSourcedQueueProcessorMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("send", () => {
    it("immediately processes payload through process function", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: "test-queue",
        process: processFn,
      };

      const processor = new EventSourcedQueueProcessorMemory(definition);
      await processor.send({ id: "test-payload" });

      expect(processFn).toHaveBeenCalledWith({ id: "test-payload" });
    });

    it("propagates errors from process function", async () => {
      const error = new Error("Processing error");
      const processFn = vi.fn().mockRejectedValue(error);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: "test-queue",
        process: processFn,
      };

      const processor = new EventSourcedQueueProcessorMemory(definition);

      await expect(processor.send({ id: "test-payload" })).rejects.toThrow(
        "Processing error",
      );
      expect(processFn).toHaveBeenCalledWith({ id: "test-payload" });
    });

    it("awaits processing completion before returning", async () => {
      let resolveProcess!: () => void;
      const processPromise = new Promise<void>((resolve) => {
        resolveProcess = resolve;
      });
      const processFn = vi.fn().mockReturnValue(processPromise);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: "test-queue",
        process: processFn,
      };

      const processor = new EventSourcedQueueProcessorMemory(definition);
      const sendPromise = processor.send({ id: "test-payload" });

      expect(processFn).toHaveBeenCalledWith({ id: "test-payload" });
      expect(resolveProcess).toBeDefined();

      resolveProcess?.();
      await sendPromise;

      expect(processFn).toHaveBeenCalledTimes(1);
    });

    it("handles concurrent send calls", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: "test-queue",
        process: processFn,
      };

      const processor = new EventSourcedQueueProcessorMemory(definition);

      await Promise.all([
        processor.send({ id: "payload-1" }),
        processor.send({ id: "payload-2" }),
        processor.send({ id: "payload-3" }),
      ]);

      expect(processFn).toHaveBeenCalledTimes(3);
      expect(processFn).toHaveBeenCalledWith({ id: "payload-1" });
      expect(processFn).toHaveBeenCalledWith({ id: "payload-2" });
      expect(processFn).toHaveBeenCalledWith({ id: "payload-3" });
    });
  });

  describe("given a delay is configured", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe("when a payload is sent", () => {
      it("withholds the payload from the process function until the delay has elapsed", async () => {
        const delay = 500;
        const processFn = vi.fn().mockResolvedValue(void 0);
        const definition: EventSourcedQueueDefinition<{ id: string }> = {
          name: "test-queue",
          process: processFn,
          delay,
        };

        const processor = new EventSourcedQueueProcessorMemory(definition);
        const sendPromise = processor.send({ id: "delayed-payload" });

        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(processFn).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await sendPromise;

        expect(processFn).toHaveBeenCalledWith({ id: "delayed-payload" });
      });
    });
  });

  describe("given a concurrency limit of one", () => {
    describe("when a second payload is sent while the first is still in flight", () => {
      it("holds the second payload back until the first finishes", async () => {
        const processedIds: string[] = [];
        let releaseFirst!: () => void;
        const firstInFlight = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });

        const processFn = vi.fn(async (payload: { id: string }) => {
          processedIds.push(payload.id);
          if (payload.id === "first") {
            await firstInFlight;
          }
        });

        const definition: EventSourcedQueueDefinition<{ id: string }> = {
          name: "test-queue",
          process: processFn,
          options: { concurrency: 1 },
        };

        const processor = new EventSourcedQueueProcessorMemory(definition);
        const firstSend = processor.send({ id: "first" });
        const secondSend = processor.send({ id: "second" });

        // Drain the microtask queue: without the concurrency gate the second
        // job would already have started by now.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(processedIds).toEqual(["first"]);

        releaseFirst();
        await Promise.all([firstSend, secondSend]);

        expect(processedIds).toEqual(["first", "second"]);
      });
    });
  });

  describe("close", () => {
    it("completes without errors", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: "test-queue",
        process: processFn,
      };

      const processor = new EventSourcedQueueProcessorMemory(definition);
      await processor.close();
    });

    it("can be called multiple times safely", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: "test-queue",
        process: processFn,
      };

      const processor = new EventSourcedQueueProcessorMemory(definition);
      await processor.close();
      await processor.close();
      await processor.close();
    });

    it("allows send after close (memory implementation has no state)", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: "test-queue",
        process: processFn,
      };

      const processor = new EventSourcedQueueProcessorMemory(definition);
      await processor.close();
      await processor.send({ id: "test-payload" });

      expect(processFn).toHaveBeenCalledWith({ id: "test-payload" });
    });
  });
});
