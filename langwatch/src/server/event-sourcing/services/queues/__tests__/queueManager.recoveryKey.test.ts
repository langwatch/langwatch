import { describe, expect, it, vi } from "vitest";

import type { EventSourcedQueueProcessor } from "../../../queues";
import {
  createTestAggregateType,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import type { JobRegistryEntry } from "../queueManager";
import { QueueManager } from "../queueManager";

// #718 AC-718.6 — the facade seam. The recovery key (event id) must be extracted
// per payload SHAPE: a reactor stages { event, foldState } (id at event.id); a
// fold/map stages the bare event (id at id). This is the ONE wire that silently
// nulls every reactor drop's name if mis-wired — a reactor payload has no
// top-level .id, so the fold extractor (p => p.id) would inject nothing.
function createMockSharedQueue(): EventSourcedQueueProcessor<any> {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };
}

describe("QueueManager recovery-key injection (#718)", () => {
  const aggregateType = createTestAggregateType();
  const tenantId = createTestTenantId();

  function newManager(globalQueue: EventSourcedQueueProcessor<any>) {
    return new QueueManager({
      aggregateType,
      pipelineName: "test-pipeline",
      globalQueue,
      globalJobRegistry: new Map<string, JobRegistryEntry>(),
    });
  }

  const firstSentPayload = (q: EventSourcedQueueProcessor<any>) =>
    (q.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<
      string,
      unknown
    >;

  describe("given a reactor facade", () => {
    describe("when an event is dispatched to it", () => {
      /** @scenario a reactor job staged through its facade carries its event id in the header */
      it("stamps the recovery key from event.id", async () => {
        const q = createMockSharedQueue();
        const manager = newManager(q);
        manager.initializeReactorQueues(
          {
            governanceOcsfEventsSync: {
              name: "governanceOcsfEventsSync",
              parentProjection: "traceSummary",
              parentType: "fold" as const,
              handler: { handle: vi.fn().mockResolvedValue(void 0) },
            },
          },
          vi.fn(),
        );
        const facade = manager.getReactorQueue("governanceOcsfEventsSync")!;
        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        await facade.send({ event, foldState: {} });

        expect(q.send).toHaveBeenCalledTimes(1);
        // Revert-check: wire the reactor facade with the fold extractor
        // (p => p.id) and this is undefined — a reactor payload has no top-level id.
        expect(firstSentPayload(q).__recoveryKey).toBe(event.id);
      });
    });
  });

  describe("given a projection (fold/map) facade", () => {
    describe("when an event is dispatched to it", () => {
      /** @scenario a fold job staged through its facade carries its event id in the header */
      it("stamps the recovery key from the bare event's id", async () => {
        const q = createMockSharedQueue();
        const manager = newManager(q);
        manager.initializeProjectionQueues(
          { traceSummary: { name: "traceSummary" } },
          vi.fn(),
        );
        const facade = manager.getProjectionQueue("traceSummary")!;
        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        await facade.send(event);

        expect(firstSentPayload(q).__recoveryKey).toBe(event.id);
      });
    });
  });
});
