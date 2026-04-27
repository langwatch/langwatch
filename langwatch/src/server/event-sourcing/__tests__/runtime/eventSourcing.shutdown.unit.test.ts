import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types";
import { EventSourcing } from "../../eventSourcing";
import { createMockEventStore } from "../../services/__tests__/testHelpers";

/**
 * Creates a mock global queue with spied close().
 */
function createMockGlobalQueue() {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };
}

/**
 * Creates a mock pipeline entry matching the PipelineWithCommandHandlers shape.
 * The service.close() is a vi.fn() so we can track calls.
 */
function createMockPipeline(name: string) {
  return {
    name,
    aggregateType: "trace" as const,
    service: {
      close: vi.fn().mockResolvedValue(void 0),
      getCommandQueues: vi.fn().mockReturnValue(new Map()),
    },
    metadata: {
      name,
      aggregateType: "trace" as const,
      projections: [],
      mapProjections: [],
      commands: [],
    },
    commands: {},
  };
}

describe("EventSourcing.close", () => {
  beforeEach(() => {
    vi.stubEnv("BUILD_TIME", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("calls close on all registered pipelines", async () => {
    const mockEventStore = createMockEventStore<Event>();
    const mockGlobalQueue = createMockGlobalQueue();
    const es = EventSourcing.createForTesting({
      eventStore: mockEventStore,
      globalQueue: mockGlobalQueue,
    });

    const pipelineA = createMockPipeline("pipeline-a");
    const pipelineB = createMockPipeline("pipeline-b");

    // Inject mock pipelines via the private map
    const pipelines = (es as any).pipelines as Map<string, any>;
    pipelines.set("pipeline-a", pipelineA);
    pipelines.set("pipeline-b", pipelineB);

    await es.close();

    expect(pipelineA.service.close).toHaveBeenCalledOnce();
    expect(pipelineB.service.close).toHaveBeenCalledOnce();
  });

  it("calls close on the global queue", async () => {
    const mockGlobalQueue = createMockGlobalQueue();
    const es = EventSourcing.createForTesting({
      eventStore: createMockEventStore<Event>(),
      globalQueue: mockGlobalQueue,
    });

    await es.close();

    expect(mockGlobalQueue.close).toHaveBeenCalledOnce();
  });

  it("catches pipeline close errors and continues closing other pipelines", async () => {
    const mockGlobalQueue = createMockGlobalQueue();
    const es = EventSourcing.createForTesting({
      eventStore: createMockEventStore<Event>(),
      globalQueue: mockGlobalQueue,
    });

    const failingPipeline = createMockPipeline("failing");
    failingPipeline.service.close.mockRejectedValue(
      new Error("close failed"),
    );
    const healthyPipeline = createMockPipeline("healthy");

    const pipelines = (es as any).pipelines as Map<string, any>;
    pipelines.set("failing", failingPipeline);
    pipelines.set("healthy", healthyPipeline);

    // close() must not throw even though one pipeline fails
    await expect(es.close()).resolves.toBeUndefined();

    expect(failingPipeline.service.close).toHaveBeenCalledOnce();
    expect(healthyPipeline.service.close).toHaveBeenCalledOnce();
    expect(mockGlobalQueue.close).toHaveBeenCalledOnce();
  });

  it("clears the pipelines map after close", async () => {
    const es = EventSourcing.createForTesting({
      eventStore: createMockEventStore<Event>(),
      globalQueue: createMockGlobalQueue(),
    });

    const pipeline = createMockPipeline("to-clear");
    (es as any).pipelines.set("to-clear", pipeline);

    // Pipeline is reachable before close
    expect(es.getPipeline("to-clear")).toBe(pipeline);

    await es.close();

    expect(() => es.getPipeline("to-clear")).toThrow(
      'Pipeline "to-clear" not found',
    );
  });

  it("closes pipelines before global queue", async () => {
    const callOrder: string[] = [];

    const mockGlobalQueue = createMockGlobalQueue();
    mockGlobalQueue.close.mockImplementation(async () => {
      callOrder.push("global-queue");
    });

    const es = EventSourcing.createForTesting({
      eventStore: createMockEventStore<Event>(),
      globalQueue: mockGlobalQueue,
    });

    const pipeline = createMockPipeline("ordered");
    pipeline.service.close.mockImplementation(async () => {
      callOrder.push("pipeline:ordered");
    });

    (es as any).pipelines.set("ordered", pipeline);

    await es.close();

    expect(callOrder).toEqual(["pipeline:ordered", "global-queue"]);
  });

  it("handles close with no registered pipelines", async () => {
    const mockGlobalQueue = createMockGlobalQueue();
    const es = EventSourcing.createForTesting({
      eventStore: createMockEventStore<Event>(),
      globalQueue: mockGlobalQueue,
    });

    // No pipelines registered — close must still resolve
    await expect(es.close()).resolves.toBeUndefined();

    // Global queue is still closed
    expect(mockGlobalQueue.close).toHaveBeenCalledOnce();
  });
});
