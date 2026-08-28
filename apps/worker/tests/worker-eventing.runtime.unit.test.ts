import { EventStoreMemory } from "@langwatch/eventing/testing";
import { InMemoryProcessStore, type EventSourcedQueueProcessor } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import { WorkerEventingRuntime } from "../src/platform/eventing/worker-eventing.runtime";

class TestQueue implements EventSourcedQueueProcessor<Record<string, unknown>> {
  readonly send = vi.fn(async () => undefined);
  readonly sendBatch = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly waitUntilReady = vi.fn(async () => undefined);
}

describe("WorkerEventingRuntime", () => {
  it("requires explicit consumer activation and closes its shared queue", async () => {
    const queue = new TestQueue();
    const runtime = WorkerEventingRuntime.create({
      eventStore: new EventStoreMemory(),
      queueFactory: () => queue,
      processStore: new InMemoryProcessStore(),
      executionTarget: "worker",
      consumersEnabled: true,
    });

    await runtime.start();
    await runtime.close();

    expect(queue.waitUntilReady).toHaveBeenCalledOnce();
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("rejects a new start after closing", async () => {
    const runtime = WorkerEventingRuntime.create({
      eventStore: new EventStoreMemory(),
      queueFactory: () => new TestQueue(),
      processStore: new InMemoryProcessStore(),
      executionTarget: "worker",
      consumersEnabled: false,
    });

    await runtime.close();

    await expect(runtime.start()).rejects.toThrow("Worker Eventing runtime is closed.");
  });
});
