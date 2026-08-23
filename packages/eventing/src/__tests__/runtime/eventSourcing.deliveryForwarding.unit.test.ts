/**
 * The shared queue's wrappers must forward the delivery to the registry entry.
 *
 * Dropping it is silent and catastrophic in slow motion: every entry downstream
 * forwards `delivery.attempt` as `deliveryAttempt`, the fold executor keys its
 * applied-id merge on it, and the queue passes it in — so this wrapper is the
 * single point where losing the argument pins every delivery at attempt 1 and
 * disables retry dedup for the whole system (#6578). The fold idempotency suite
 * cannot catch that, because its harness wires its own queue definition and
 * forwards the delivery itself. This test pins the wrapper.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventSourcing } from "../../eventSourcing";
import type { EventSourcedQueueDefinition } from "../../queues";

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

      await captured.definition!.process(
        { ...ROUTING, value: "a" },
        { attempt: 3 },
      );

      expect(entry.process).toHaveBeenCalledWith(
        { value: "a" },
        { attempt: 3 },
      );
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

      expect(entry.processBatch).toHaveBeenCalledWith(
        [{ value: "a" }, { value: "b" }],
        { attempt: 2, isContinuation: true },
      );
      await eventSourcing.close();
    });
  });
});
