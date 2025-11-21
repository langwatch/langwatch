import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventSourcedQueueDefinition } from "../../../library/queues";

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockTracer = {
  withActiveSpan: vi.fn((name, options, fn) => fn()),
};

vi.mock("../../../../utils/logger", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: vi.fn(() => mockTracer),
}));

vi.mock("../../../../redis", async () => {
  const actual =
    await vi.importActual<typeof import("../../../../redis")>(
      "../../../../redis",
    );
  return {
    ...actual,
    connection: undefined,
  };
});

import {
  DefaultQueueProcessorFactory,
  BullmqQueueProcessorFactory,
  MemoryQueueProcessorFactory,
  defaultQueueProcessorFactory,
} from "../factory";
import * as redisModule from "../../../../redis";

describe("DefaultQueueProcessorFactory", () => {
  let factory: DefaultQueueProcessorFactory;
  let connectionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new DefaultQueueProcessorFactory();
    connectionSpy = vi.spyOn(redisModule, "connection", "get");
  });

  afterEach(async () => {
    // Clean up any processors created during tests
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("returns working memory processor when Redis is unavailable", async () => {
      connectionSpy.mockReturnValue(undefined);

      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<string> = {
        name: "test-queue",
        process: processFn,
      };

      const processor = factory.create(definition);

      // Test that the processor actually works
      await processor.send("test-payload");
      expect(processFn).toHaveBeenCalledWith("test-payload");

      await processor.close();
    });

    it("returns working BullMQ processor when Redis is available", async () => {
      // Mock a Redis connection object
      const mockRedisConnection = {
        host: "localhost",
        port: 6379,
      } as any;
      connectionSpy.mockReturnValue(mockRedisConnection);

      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<string> = {
        name: "test-queue-factory",
        process: processFn,
      };

      const processor = factory.create(definition);

      // Test that the processor implements the interface
      expect(processor).toHaveProperty("send");
      expect(processor).toHaveProperty("close");

      // Note: We can't actually test BullMQ send/close without a real Redis instance,
      // but we can verify the processor was created and has the right interface
      // The actual BullMQ behavior is tested in integration tests
      await processor.close();
    });

    it("adapts to connection state changes between calls", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<string> = {
        name: "test-queue-adapt",
        process: processFn,
      };

      // First call: Redis unavailable -> memory processor
      connectionSpy.mockReturnValue(undefined);
      const processor1 = factory.create(definition);
      await processor1.send("payload-1");
      expect(processFn).toHaveBeenCalledWith("payload-1");

      // Second call: Redis available -> BullMQ processor
      connectionSpy.mockReturnValue({ host: "localhost", port: 6379 } as any);
      const processor2 = factory.create(definition);
      expect(processor2).toHaveProperty("send");
      expect(processor2).toHaveProperty("close");

      await processor2.close();
    });
  });
});

describe("BullmqQueueProcessorFactory", () => {
  let factory: BullmqQueueProcessorFactory;
  let connectionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new BullmqQueueProcessorFactory();
    connectionSpy = vi.spyOn(redisModule, "connection", "get");
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("returns BullMQ processor when Redis is available", () => {
      connectionSpy.mockReturnValue({ host: "localhost", port: 6379 } as any);

      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<string> = {
        name: "test-queue-bullmq",
        process: processFn,
      };

      const processor = factory.create(definition);

      expect(processor).toHaveProperty("send");
      expect(processor).toHaveProperty("close");
    });

    it("throws error when Redis connection is missing", () => {
      connectionSpy.mockReturnValue(undefined);

      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<string> = {
        name: "test-queue-error",
        process: processFn,
      };

      expect(() => {
        factory.create(definition);
      }).toThrow(
        "BullMQ queue processor requires Redis connection. Use memory implementation instead.",
      );
    });
  });
});

describe("MemoryQueueProcessorFactory", () => {
  let factory: MemoryQueueProcessorFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new MemoryQueueProcessorFactory();
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("returns working memory processor", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<string> = {
        name: "test-queue-memory",
        process: processFn,
      };

      const processor = factory.create(definition);

      // Test that the processor actually works
      await processor.send("test-payload");
      expect(processFn).toHaveBeenCalledWith("test-payload");

      await processor.close();
    });
  });
});

describe("defaultQueueProcessorFactory", () => {
  let connectionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    connectionSpy = vi.spyOn(redisModule, "connection", "get");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exports singleton instance of DefaultQueueProcessorFactory", () => {
    expect(defaultQueueProcessorFactory).toBeDefined();
    expect(defaultQueueProcessorFactory).toBeInstanceOf(
      DefaultQueueProcessorFactory,
    );
  });

  it("creates working memory processor when Redis is unavailable", async () => {
    connectionSpy.mockReturnValue(undefined);

    const processFn = vi.fn().mockResolvedValue(void 0);
    const definition: EventSourcedQueueDefinition<string> = {
      name: "test-queue-default",
      process: processFn,
    };

    const processor = defaultQueueProcessorFactory.create(definition);

    await processor.send("test-payload");
    expect(processFn).toHaveBeenCalledWith("test-payload");

    await processor.close();
  });
});
