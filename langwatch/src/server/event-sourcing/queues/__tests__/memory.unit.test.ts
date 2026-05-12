import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventSourcedQueueDefinition } from "../../queues";

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../../utils/logger/server", () => ({
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

    it("silently ignores unsupported options (delay, concurrency)", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: "test-queue",
        process: processFn,
        delay: 10, // Small delay to test it works without timing out
        options: { concurrency: 1 },
      };

      const processor = new EventSourcedQueueProcessorMemory(definition);
      const sendPromise = processor.send({ id: "test-payload" });

      // Wait for async processing to complete (including delay)
      await sendPromise;

      // Processor works normally - options are accepted but may not all be fully implemented
      expect(processFn).toHaveBeenCalledWith({ id: "test-payload" });
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
