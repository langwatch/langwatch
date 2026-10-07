/**
 * Pausing eventing consumers pauses the global queue and the process runtime
 * together, and a queue started after the pause starts paused.
 * Spec: packages/eventing/specs/consumer-pause.feature
 */
import { describe, expect, it, vi } from "vitest";

import { EventSourcing } from "../../eventSourcing.ts";
import { ProcessRuntime } from "../../process-manager/processRuntime.ts";
import { InMemoryProcessStore } from "../../process-manager/stores/inMemoryProcessStore.ts";
import type { EventSourcedQueueProcessor } from "../../queues/queue.types.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";

function runtimeOverPausableQueue() {
  const start = vi.fn();
  const pause = vi.fn();
  const resume = vi.fn();
  const queue: EventSourcedQueueProcessor<Record<string, unknown>> = {
    send: async () => undefined,
    sendBatch: async () => undefined,
    close: async () => undefined,
    waitUntilReady: async () => undefined,
    start,
    pause,
    resume,
  };
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
    queueFactory: () => queue,
  });
  return { eventing, start, pause, resume };
}

describe("EventSourcing pauseConsumers", () => {
  describe("given a started runtime with a global queue and a process runtime", () => {
    /** @scenario "Eventing pauses and resumes its global queue and process runtime together" */
    it("pauses and resumes both", () => {
      const { eventing, pause, resume } = runtimeOverPausableQueue();
      expect(eventing.globalQueue).toBeDefined();
      const runtimePause = vi.spyOn(eventing.processRuntime, "pause");
      const runtimeResume = vi.spyOn(eventing.processRuntime, "resume");

      eventing.pauseConsumers();
      eventing.resumeConsumers();

      expect(pause).toHaveBeenCalledTimes(1);
      expect(resume).toHaveBeenCalledTimes(1);
      expect(runtimePause).toHaveBeenCalledTimes(1);
      expect(runtimeResume).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a held runtime paused before its consumers start", () => {
    /** @scenario "Eventing pauses and resumes its global queue and process runtime together" */
    it("starts the queue and pauses it straight after", () => {
      const { eventing, start, pause } = runtimeOverPausableQueue();
      eventing.holdConsumers();
      eventing.pauseConsumers();
      const runtimePause = vi.spyOn(ProcessRuntime.prototype, "pause");
      expect(eventing.processRuntime).toBeDefined();
      expect(eventing.globalQueue).toBeDefined();

      eventing.startConsumers();

      expect(start).toHaveBeenCalledTimes(1);
      expect(pause.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
        start.mock.invocationCallOrder[0]!,
      );
      expect(runtimePause).toHaveBeenCalledTimes(1);
      runtimePause.mockRestore();
    });
  });
});
