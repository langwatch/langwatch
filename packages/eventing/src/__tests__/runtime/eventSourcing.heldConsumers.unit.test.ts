/**
 * A held runtime claims no job until its composition says construction is over.
 * Spec: specs/server/declarative-process-composition.feature
 */
import { describe, expect, it, vi } from "vitest";

import { EventSourcing } from "../../eventSourcing.ts";
import type { EventSourcedQueueProcessor } from "../../queues/queue.types.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";

function runtimeOverStartableQueue() {
  const start = vi.fn();
  const queue: EventSourcedQueueProcessor<Record<string, unknown>> = {
    send: async () => undefined,
    sendBatch: async () => undefined,
    close: async () => undefined,
    waitUntilReady: async () => undefined,
    start,
  };
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    queueFactory: () => queue,
  });
  return { eventing, start };
}

describe("EventSourcing consumers", () => {
  describe("given a runtime its composition never held", () => {
    it("starts the global queue's consumer as soon as the queue exists", () => {
      const { eventing, start } = runtimeOverStartableQueue();

      expect(eventing.globalQueue).toBeDefined();

      expect(start).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a runtime held before its first pipeline", () => {
    /** @scenario "Eventing consumers start only once the booted runtime starts" */
    it("claims nothing until startConsumers, then starts the consumer once", () => {
      const { eventing, start } = runtimeOverStartableQueue();
      eventing.holdConsumers();

      expect(eventing.globalQueue).toBeDefined();
      expect(start).not.toHaveBeenCalled();

      eventing.startConsumers();
      eventing.startConsumers();

      expect(start).toHaveBeenCalledTimes(1);
    });
  });
});
