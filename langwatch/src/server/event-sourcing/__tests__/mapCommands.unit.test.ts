import { describe, expect, it, vi } from "vitest";
import { mapCommands } from "../mapCommands";
import type { EventSourcedQueueProcessor } from "../queues";

function createMockProcessor<P extends Record<string, unknown>>(): EventSourcedQueueProcessor<P> {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    waitUntilReady: vi.fn().mockResolvedValue(undefined),
  };
}

describe("mapCommands", () => {
  describe("when called without options", () => {
    it("delegates to processor.send with data only", async () => {
      const processor = createMockProcessor();
      const mapped = mapCommands({ myCommand: processor });

      await mapped.myCommand({ foo: "bar" });

      expect(processor.send).toHaveBeenCalledWith({ foo: "bar" }, undefined);
    });
  });

  describe("when called with options", () => {
    it("forwards options to processor.send", async () => {
      const processor = createMockProcessor();
      const mapped = mapCommands({ myCommand: processor });

      const options = {
        delay: 300_000,
        deduplication: {
          makeId: (p: any) => p.foo,
          ttlMs: 300_000,
        },
      };

      await mapped.myCommand({ foo: "bar" }, options);

      expect(processor.send).toHaveBeenCalledWith({ foo: "bar" }, options);
    });
  });
});
