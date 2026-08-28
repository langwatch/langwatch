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
  it("requires completed registrations before it awaits producer-only queue readiness", async () => {
    const queue = new TestQueue();
    const runtime = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
    });

    await expect(runtime.start()).rejects.toThrow(
      "Worker Eventing registrations must complete before queue readiness is awaited.",
    );
    expect(queue.waitUntilReady).not.toHaveBeenCalled();

    runtime.completeRegistrations();
    await runtime.start();
    await runtime.close();

    expect(queue.waitUntilReady).toHaveBeenCalledOnce();
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("shares one failed readiness attempt and permits a later retry", async () => {
    const queue = new TestQueue();
    const readinessError = new Error("Redis is unavailable");
    queue.waitUntilReady.mockRejectedValueOnce(readinessError).mockResolvedValueOnce(void 0);
    const runtime = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
    });

    runtime.completeRegistrations();
    const firstStart = runtime.start();
    const concurrentStart = runtime.start();

    expect(concurrentStart).toBe(firstStart);
    await expect(firstStart).rejects.toThrow(readinessError);
    await expect(concurrentStart).rejects.toThrow(readinessError);
    expect(queue.waitUntilReady).toHaveBeenCalledOnce();

    await runtime.start();

    expect(queue.waitUntilReady).toHaveBeenCalledTimes(2);
  });

  it("rejects a new start after closing", async () => {
    const runtime = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => new TestQueue(),
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumersEnabled: false,
    });

    runtime.completeRegistrations();
    await runtime.close();

    await expect(runtime.start()).rejects.toThrow("Worker Eventing runtime is closed.");
  });
});
