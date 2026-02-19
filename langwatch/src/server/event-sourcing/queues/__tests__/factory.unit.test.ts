import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventSourcedQueueDefinition } from "../../queues";

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockTracer = {
  withActiveSpan: vi.fn((_name, _optionss, fn) => fn()),
};

vi.mock("../../../../utils/logger/server", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: vi.fn(() => mockTracer),
}));

vi.mock("../../../redis", async () => {
  const actual =
    await vi.importActual<typeof import("../../../redis")>(
      "../../../redis",
    );
  return {
    ...actual,
    connection: undefined,
  };
});

import * as redisModule from "../../../redis";
import {
	BullmqQueueProcessorFactory,
	DefaultQueueProcessorFactory,
	defaultQueueProcessorFactory,
	MemoryQueueProcessorFactory,
} from "../factory";

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
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: "test-queue",
        process: processFn,
      };

      const processor = factory.create(definition);

      // Test that the processor actually works
      await processor.send({ id: "test-payload" });
      expect(processFn).toHaveBeenCalledWith({ id: "test-payload" });

      await processor.close();
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
    it("throws error when Redis connection is missing (no groupKey)", () => {
      connectionSpy.mockReturnValue(undefined);

      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: "test-queue-error",
        process: processFn,
      };

      expect(() => {
        factory.create(definition);
      }).toThrow(
        "Simple queue processor requires Redis connection",
      );
    });

    it("throws error when Redis connection is missing (with groupKey)", () => {
      connectionSpy.mockReturnValue(undefined);

      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: "test-queue-error-group",
        process: processFn,
        groupKey: (payload) => payload.id,
      };

      expect(() => {
        factory.create(definition);
      }).toThrow(
        "Group queue processor requires Redis connection",
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
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: "test-queue-memory",
        process: processFn,
      };

      const processor = factory.create(definition);

      // Test that the processor actually works
      await processor.send({ id: "test-payload" });
      expect(processFn).toHaveBeenCalledWith({ id: "test-payload" });

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
    const definition: EventSourcedQueueDefinition<{ id: string }> = {
      name: "test-queue-default",
      process: processFn,
    };

    const processor = defaultQueueProcessorFactory.create(definition);

    await processor.send({ id: "test-payload" });
    expect(processFn).toHaveBeenCalledWith({ id: "test-payload" });

    await processor.close();
  });
});
