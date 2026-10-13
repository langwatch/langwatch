/**
 * @vitest-environment node
 * Registry must close AFTER queue drain to prevent event loss. Regression from
 * 55 dropped batches in worker graceful shutdown. {@link
 * specs/background/worker-graceful-shutdown.feature}
 */
import { describe, expect, it, vi } from "vitest";

import type { Event } from "../domain/types.ts";
import { EventSourcing } from "../eventSourcing.ts";
import type { ProjectionRegistry } from "../projections/projectionRegistry.ts";
import type { EventSourcedQueueProcessor } from "../queues/index.ts";
import { createMockFoldProjectionDefinition } from "../services/__tests__/testHelpers.ts";
import { EventStoreMemory } from "../stores/eventStoreMemory.ts";

/**
 * Test close order: queue closes before registry. Queue drain is held open
 * until finishQueueDrain() called.
 */
function closeWithRecording() {
  const order: string[] = [];
  let releaseQueueDrain: (() => void) | undefined;
  const queueDrained = new Promise<void>((resolve) => {
    releaseQueueDrain = resolve;
  });
  const registries: ProjectionRegistry<Event>[] = [];
  const registryClosed = () => registries.every((registry) => !registry.isInitialized);

  const globalQueue: EventSourcedQueueProcessor<Record<string, unknown>> = {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
    close: async () => {
      order.push("globalQueue:start");
      await queueDrained;
      order.push(registryClosed() ? "projectionRegistry" : "globalQueue:done");
    },
  };
  const eventSourcing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    queueFactory: () => globalQueue,
    configureGlobalProjections: (registry) => {
      registry.registerFoldProjection(createMockFoldProjectionDefinition("any-fold"));
      registry.initialize(globalQueue, new Map());
      registries.push(registry);
    },
  });
  void eventSourcing.globalQueue;

  return {
    eventSourcing,
    order,
    finishQueueDrain: () => releaseQueueDrain?.(),
    recordRegistryState: () => {
      if (registryClosed()) order.push("projectionRegistry");
    },
  };
}

/** Lets any already-scheduled microtasks run, so a premature close would show. */
const settleMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("closing event sourcing", () => {
  describe("given an initialized projection registry", () => {
    describe("when the queue drain is still in flight", () => {
      /** @scenario "The projection registry is closed after the queue that feeds it" */
      it("has not yet closed the projection registry", async () => {
        const { eventSourcing, order, finishQueueDrain, recordRegistryState } =
          closeWithRecording();

        const closing = eventSourcing.close();
        await settleMicrotasks();
        recordRegistryState();

        expect(order).toEqual(["globalQueue:start"]);

        finishQueueDrain();
        await closing;
      });
    });

    describe("when close() runs to completion", () => {
      /** @scenario "The projection registry is closed after the queue that feeds it" */
      it("closes the global queue before the projection registry", async () => {
        const { eventSourcing, order, finishQueueDrain, recordRegistryState } =
          closeWithRecording();

        const closing = eventSourcing.close();
        await settleMicrotasks();
        finishQueueDrain();
        await closing;
        recordRegistryState();

        expect(order).toEqual(["globalQueue:start", "globalQueue:done", "projectionRegistry"]);
      });
    });
  });
});
