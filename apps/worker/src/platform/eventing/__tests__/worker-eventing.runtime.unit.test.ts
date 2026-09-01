import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  InMemoryProcessStore,
  type Event,
  type EventSourcedQueueProcessor,
  type MapProjectionDefinition,
  type SubscriberDispatchDefinition,
} from "@langwatch/eventing";
import { createBlobMaintenancePipeline } from "@langwatch/eventing/server";
import { describe, expect, it, vi } from "vitest";
import { WorkerEventingRuntime } from "../worker-eventing.runtime";

/**
 * A cross-pipeline map projection and the subscriber that follows it, reduced
 * to the shape the registry needs. The live SaaS pair is the billable-events
 * meter and its usage-reporting dispatch; what matters here is that both land
 * in the shared job registry under `global:`, because that is the namespace a
 * consumer of `event-sourcing/jobs` has to be able to route.
 */
const meterProjection: MapProjectionDefinition<{ eventId: string }, Event> = {
  name: "orgBillableEventsMeter",
  eventTypes: ["lw.obs.trace.span_received"],
  map: (event) => ({ eventId: event.id }),
  store: { append: async () => void 0 },
};

const meterDispatch: SubscriberDispatchDefinition<Event> = {
  name: "billingMeterDispatch",
  options: { runIn: ["worker"] },
  handle: async () => void 0,
};

/** A real registration, so the projection registry initializes its queues. */
function anyPipeline() {
  return createBlobMaintenancePipeline({
    cleanup: {
      sweep: async () => ({
        queues: [],
        totals: {
          scanned: 0,
          truncated: false,
          leased: 0,
          repaired: 0,
          reclaimed: 0,
          bookkeeping: 0,
          pending: 0,
        },
        dryRun: false,
        durationMs: 0,
      }),
      deleteDispatchedBefore: async () => 0,
    },
  });
}

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

describe("WorkerEventingRuntime global projections", () => {
  describe("given cross-pipeline projections the composition root supplies", () => {
    describe("when the first pipeline registers", () => {
      it("routes their jobs through the same shared registry as every pipeline", () => {
        const runtime = WorkerEventingRuntime.create({
          eventStore: EventStoreMemory.createForTesting(),
          queueFactory: () => new TestQueue(),
          processStore: InMemoryProcessStore.createForTesting(),
          executionTarget: "worker",
          warnWhenProjectionsRunInline: false,
          consumersEnabled: false,
          configureGlobalProjections: (registry) => {
            registry.registerMapProjection(meterProjection);
            registry.registerMapSubscriber("orgBillableEventsMeter", meterDispatch);
          },
        });

        runtime.eventSourcing.register(anyPipeline());

        expect([...runtime.eventSourcing.globalJobRegistry.keys()]).toEqual(
          expect.arrayContaining([
            "global:handler:orgBillableEventsMeter",
            "global:reactor:billingMeterDispatch",
          ]),
        );
      });
    });
  });

  describe("given a composition root that supplies none", () => {
    describe("when the first pipeline registers", () => {
      it("registers no global routing keys at all", () => {
        const runtime = WorkerEventingRuntime.create({
          eventStore: EventStoreMemory.createForTesting(),
          queueFactory: () => new TestQueue(),
          processStore: InMemoryProcessStore.createForTesting(),
          executionTarget: "worker",
          warnWhenProjectionsRunInline: false,
          consumersEnabled: false,
        });

        runtime.eventSourcing.register(anyPipeline());

        expect(
          [...runtime.eventSourcing.globalJobRegistry.keys()].filter((key) =>
            key.startsWith("global:"),
          ),
        ).toEqual([]);
      });
    });
  });
});
