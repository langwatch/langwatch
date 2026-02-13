import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, ProcessorCheckpoint } from "../../../domain/types";
import type { CheckpointStore } from "../../../stores/checkpointStore.types";
import type { EventStore } from "../../../stores/eventStore.types";
import {
  createMockEventStore,
  createMockCheckpointStore,
  createTestContext,
  createTestEvent,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import { ProjectionBatchProcessor } from "../projectionBatchProcessor";

describe("ProjectionBatchProcessor", () => {
  let eventStore: EventStore<Event>;
  let checkpointStore: CheckpointStore;
  let batchProcessor: ProjectionBatchProcessor<Event>;

  const { aggregateType, tenantId } = createTestContext();
  const pipelineName = TEST_CONSTANTS.PIPELINE_NAME;
  const processorName = TEST_CONSTANTS.HANDLER_NAME;
  const aggregateId = TEST_CONSTANTS.AGGREGATE_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    eventStore = createMockEventStore<Event>();
    checkpointStore = createMockCheckpointStore();

    batchProcessor = new ProjectionBatchProcessor(
      eventStore,
      checkpointStore,
      pipelineName,
      aggregateType,
    );
  });

  describe("processUnprocessedEvents", () => {
    describe("when aggregate has failed events", () => {
      it("skips processing and returns failure result", async () => {
        vi.mocked(checkpointStore.hasFailedEvents).mockResolvedValue(true);

        const triggerEvent = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
        );
        const processEvent = vi.fn();

        const result = await batchProcessor.processUnprocessedEvents(
          triggerEvent,
          processorName,
          "handler",
          processEvent,
        );

        expect(result.success).toBe(false);
        expect(result.processedCount).toBe(0);
        expect(result.error?.message).toContain("failed processing");
        expect(processEvent).not.toHaveBeenCalled();
      });
    });

    describe("when trigger event is the only event and already processed", () => {
      it("returns success with zero processed", async () => {
        const triggerEvent = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          1000,
        );

        vi.mocked(eventStore.getEvents).mockResolvedValue([triggerEvent]);
        vi.mocked(checkpointStore.getLastProcessedEvent).mockResolvedValue({
          processorName,
          processorType: "handler",
          eventId: triggerEvent.id,
          status: "processed",
          eventTimestamp: triggerEvent.timestamp,
          sequenceNumber: 1,
          tenantId,
          aggregateType,
          aggregateId,
        } as ProcessorCheckpoint);

        const processEvent = vi.fn();

        const result = await batchProcessor.processUnprocessedEvents(
          triggerEvent,
          processorName,
          "handler",
          processEvent,
        );

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(0);
        expect(result.totalUnprocessedCount).toBe(0);
        expect(processEvent).not.toHaveBeenCalled();
      });
    });

    describe("when all events are already processed", () => {
      it("returns success with zero processed", async () => {
        const event1 = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          1000,
        );
        // Trigger event is the latest event (event2)
        const triggerEvent = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          2000,
        );

        vi.mocked(eventStore.getEvents).mockResolvedValue([
          event1,
          triggerEvent,
        ]);
        vi.mocked(checkpointStore.getLastProcessedEvent).mockResolvedValue({
          processorName,
          processorType: "handler",
          eventId: triggerEvent.id,
          status: "processed",
          eventTimestamp: triggerEvent.timestamp,
          sequenceNumber: 2,
          tenantId,
          aggregateType,
          aggregateId,
        } as ProcessorCheckpoint);

        const processEvent = vi.fn();

        const result = await batchProcessor.processUnprocessedEvents(
          triggerEvent,
          processorName,
          "handler",
          processEvent,
        );

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(0);
        expect(result.totalUnprocessedCount).toBe(0);
        expect(processEvent).not.toHaveBeenCalled();
      });
    });

    describe("when some events are unprocessed", () => {
      it("processes only unprocessed events in sequence order", async () => {
        const event1 = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          1000,
          void 0,
          {},
          "event-1",
        );
        const event2 = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          2000,
          void 0,
          {},
          "event-2",
        );
        // Trigger event is the latest event (event3)
        const triggerEvent = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          3000,
          void 0,
          {},
          "event-3",
        );

        vi.mocked(eventStore.getEvents).mockResolvedValue([
          event1,
          event2,
          triggerEvent,
        ]);
        vi.mocked(checkpointStore.getLastProcessedEvent).mockResolvedValue({
          processorName,
          processorType: "handler",
          eventId: event1.id,
          status: "processed",
          eventTimestamp: event1.timestamp,
          sequenceNumber: 1,
          tenantId,
          aggregateType,
          aggregateId,
        } as ProcessorCheckpoint);

        const processedEvents: Array<{ event: Event; sequence: number }> = [];
        const processEvent = vi.fn().mockImplementation((event, sequence) => {
          processedEvents.push({ event, sequence });
          return Promise.resolve();
        });

        const result = await batchProcessor.processUnprocessedEvents(
          triggerEvent,
          processorName,
          "handler",
          processEvent,
        );

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(2);
        expect(result.totalUnprocessedCount).toBe(2);
        expect(result.lastProcessedSequence).toBe(3);

        // Verify events were processed in order
        expect(processedEvents).toHaveLength(2);
        expect(processedEvents[0]?.event.id).toBe("event-2");
        expect(processedEvents[0]?.sequence).toBe(2);
        expect(processedEvents[1]?.event.id).toBe("event-3");
        expect(processedEvents[1]?.sequence).toBe(3);
      });
    });

    describe("when processing fails mid-batch", () => {
      it("throws error after partial processing", async () => {
        const event1 = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          1000,
          void 0,
          {},
          "event-1",
        );
        const event2 = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          2000,
          void 0,
          {},
          "event-2",
        );
        // Trigger event is the latest event (event3)
        const triggerEvent = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          3000,
          void 0,
          {},
          "event-3",
        );

        vi.mocked(eventStore.getEvents).mockResolvedValue([
          event1,
          event2,
          triggerEvent,
        ]);
        vi.mocked(checkpointStore.getLastProcessedEvent).mockResolvedValue(
          null,
        );

        const processError = new Error("Processing failed at event 2");
        const processEvent = vi
          .fn()
          .mockResolvedValueOnce(void 0) // event1 succeeds
          .mockRejectedValueOnce(processError); // event2 fails

        await expect(
          batchProcessor.processUnprocessedEvents(
            triggerEvent,
            processorName,
            "handler",
            processEvent,
          ),
        ).rejects.toThrow("Processing failed at event 2");

        // Verify first event was processed before failure
        expect(processEvent).toHaveBeenCalledTimes(2);
      });
    });

    describe("when events are out of order in event store", () => {
      it("sorts events by timestamp before processing", async () => {
        // Events returned out of order from store
        const event2 = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          2000,
          void 0,
          {},
          "event-2",
        );
        const event1 = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          1000,
          void 0,
          {},
          "event-1",
        );
        // Trigger event is the latest event (event3)
        const triggerEvent = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          3000,
          void 0,
          {},
          "event-3",
        );

        vi.mocked(eventStore.getEvents).mockResolvedValue([
          event2,
          event1,
          triggerEvent,
        ]);
        vi.mocked(checkpointStore.getLastProcessedEvent).mockResolvedValue(
          null,
        );

        const processedEvents: string[] = [];
        const processEvent = vi.fn().mockImplementation((event) => {
          processedEvents.push(event.id);
          return Promise.resolve();
        });

        await batchProcessor.processUnprocessedEvents(
          triggerEvent,
          processorName,
          "handler",
          processEvent,
        );

        // Verify events were processed in timestamp order
        expect(processedEvents).toEqual(["event-1", "event-2", "event-3"]);
      });
    });

    describe("when events have same timestamp", () => {
      it("uses event ID for tie-breaking", async () => {
        const event1 = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          1000,
          void 0,
          {},
          "aaa-event",
        );
        const event2 = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          1000,
          void 0,
          {},
          "bbb-event",
        );
        // Trigger event is the latest event by ID (ccc-event)
        const triggerEvent = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          1000,
          void 0,
          {},
          "ccc-event",
        );

        vi.mocked(eventStore.getEvents).mockResolvedValue([
          triggerEvent,
          event1,
          event2,
        ]);
        vi.mocked(checkpointStore.getLastProcessedEvent).mockResolvedValue(
          null,
        );

        const processedEvents: string[] = [];
        const processEvent = vi.fn().mockImplementation((event) => {
          processedEvents.push(event.id);
          return Promise.resolve();
        });

        await batchProcessor.processUnprocessedEvents(
          triggerEvent,
          processorName,
          "handler",
          processEvent,
        );

        // Verify events were processed in ID order (alphabetically)
        expect(processedEvents).toEqual([
          "aaa-event",
          "bbb-event",
          "ccc-event",
        ]);
      });
    });

    describe("when no checkpoint store is configured", () => {
      it("processes all events from the beginning", async () => {
        const batchProcessorNoCheckpoint = new ProjectionBatchProcessor(
          eventStore,
          void 0, // No checkpoint store
          pipelineName,
          aggregateType,
        );

        const event1 = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          1000,
        );
        // Trigger event is the latest event (event2)
        const triggerEvent = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          2000,
        );

        vi.mocked(eventStore.getEvents).mockResolvedValue([
          event1,
          triggerEvent,
        ]);

        const processEvent = vi.fn().mockResolvedValue(void 0);

        const result =
          await batchProcessorNoCheckpoint.processUnprocessedEvents(
            triggerEvent,
            processorName,
            "handler",
            processEvent,
          );

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(2);
        expect(processEvent).toHaveBeenCalledTimes(2);
      });
    });

    describe("projection processing", () => {
      it("works with projection processor type", async () => {
        // Trigger event is the only event
        const triggerEvent = createTestEvent(
          aggregateId,
          aggregateType,
          tenantId,
          void 0,
          1000,
        );

        vi.mocked(eventStore.getEvents).mockResolvedValue([triggerEvent]);
        vi.mocked(checkpointStore.getLastProcessedEvent).mockResolvedValue(
          null,
        );

        const processEvent = vi.fn().mockResolvedValue(void 0);

        const result = await batchProcessor.processUnprocessedEvents(
          triggerEvent,
          "myProjection",
          "projection",
          processEvent,
        );

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(1);

        // Verify checkpoint store was called with projection type
        expect(checkpointStore.getLastProcessedEvent).toHaveBeenCalledWith(
          pipelineName,
          "myProjection",
          "projection",
          tenantId,
          aggregateType,
          aggregateId,
        );
      });
    });
  });
});
