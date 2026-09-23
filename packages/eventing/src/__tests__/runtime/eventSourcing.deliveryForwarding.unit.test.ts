/**
 * Queue wrapper must forward delivery to registry: losing it disables retry
 * dedup. Regression guard for #6578.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventSourcing } from "../../eventSourcing.ts";
import type { EventSourcedQueueDefinition } from "../../queues/index.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";

const captured: {
  definition?: EventSourcedQueueDefinition<Record<string, unknown>>;
} = {};

const ROUTING = {
  __pipelineName: "test_pipeline",
  __jobType: "subscriber",
  __jobName: "testJob",
} as const;

function createWithEntry() {
  const eventSourcing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    queueFactory: (definition) => {
      captured.definition = definition;
      return {
        send: vi.fn().mockResolvedValue(undefined),
        sendBatch: vi.fn().mockResolvedValue(undefined),
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
    },
  });
  void eventSourcing.globalQueue;
  const entry = {
    process: vi.fn().mockResolvedValue(undefined),
    processBatch: vi.fn().mockResolvedValue(undefined),
    // The tenant gate reads both: group key's first segment must equal the
    // recorded accessor's value for the payload. These payloads carry no
    // tenantId, so "undefined" === "undefined" and the gate passes.
    getTenantId: (payload: Record<string, unknown>) => String(payload.tenantId),
    groupKeyFn: (payload: Record<string, unknown>) =>
      `${String(payload.tenantId)}/subscriber/testJob/x`,
  };
  (
    eventSourcing as unknown as {
      _globalJobRegistry: Map<string, typeof entry>;
    }
  )._globalJobRegistry.set(
    `${ROUTING.__pipelineName}:${ROUTING.__jobType}:${ROUTING.__jobName}`,
    entry,
  );
  return { eventSourcing, entry };
}

describe("the shared queue's handler wrappers", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("when the queue delivers a single job with a delivery", () => {
    it("forwards the delivery to the entry", async () => {
      const { eventSourcing, entry } = createWithEntry();

      await captured.definition!.process({ ...ROUTING, value: "a" }, { attempt: 3 });

      expect(entry.process).toHaveBeenCalledWith({ value: "a" }, { attempt: 3 });
      await eventSourcing.close();
    });
  });

  describe("when the queue delivers a coalesced batch with a delivery", () => {
    it("forwards the delivery — including the continuation flag — to the entry", async () => {
      const { eventSourcing, entry } = createWithEntry();

      await captured.definition!.processBatch!(
        [
          { ...ROUTING, value: "a" },
          { ...ROUTING, value: "b" },
        ],
        { attempt: 2, isContinuation: true },
      );

      expect(entry.processBatch).toHaveBeenCalledWith([{ value: "a" }, { value: "b" }], {
        attempt: 2,
        isContinuation: true,
      });
      await eventSourcing.close();
    });
  });
});
