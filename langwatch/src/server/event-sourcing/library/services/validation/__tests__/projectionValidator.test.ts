import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_TYPES } from "../../../domain/eventType";
import type { Event } from "../../../domain/types";
import { buildCheckpointKey } from "../../../utils/checkpointKey";
import {
  createMockEventStore,
  createMockCheckpointStore,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import { ProjectionValidator } from "../projectionValidator";

describe("ProjectionValidator", () => {
  const aggregateType = createTestAggregateType();
  const tenantId = createTestTenantId();
  const context = createTestEventStoreReadContext(tenantId);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("computeEventSequenceNumber", () => {
    it("computes sequence number correctly (1-indexed)", async () => {
      const eventStore = createMockEventStore<Event>();
      eventStore.countEventsBefore = vi.fn().mockResolvedValue(5);

      const validator = new ProjectionValidator({
        eventStore,
        aggregateType,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      const sequenceNumber = await validator.computeEventSequenceNumber(
        event,
        context,
      );

      expect(sequenceNumber).toBe(6); // count + 1
      expect(eventStore.countEventsBefore).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
        event.timestamp,
        event.id,
      );
    });

    it("returns 1 for first event (count = 0)", async () => {
      const eventStore = createMockEventStore<Event>();
      eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);

      const validator = new ProjectionValidator({
        eventStore,
        aggregateType,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      const sequenceNumber = await validator.computeEventSequenceNumber(
        event,
        context,
      );

      expect(sequenceNumber).toBe(1);
    });
  });

  describe("validateEventProcessing", () => {
    describe("when checkpoint store is not provided", () => {
      it("returns sequence number without validation", async () => {
        const eventStore = createMockEventStore<Event>();
        eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);

        const validator = new ProjectionValidator({
          eventStore,
          aggregateType,
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        });

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        const result = await validator.validateEventProcessing(
          "processor",
          "handler",
          event,
          context,
        );

        expect(result).toBe(1);
      });
    });

    describe("idempotency check", () => {
      it("returns null when event already processed", async () => {
        const eventStore = createMockEventStore<Event>();
        eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);
        const checkpointStore = createMockCheckpointStore();
        checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue({
          status: "processed",
          sequenceNumber: 1,
        });

        const validator = new ProjectionValidator({
          eventStore,
          aggregateType,
          checkpointStore: checkpointStore,
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        });

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        const result = await validator.validateEventProcessing(
          "processor",
          "handler",
          event,
          context,
        );

        expect(result).toBeNull();
        expect(checkpointStore.loadCheckpoint).toHaveBeenCalledWith(
          buildCheckpointKey(
            tenantId,
            TEST_CONSTANTS.PIPELINE_NAME,
            "processor",
            TEST_CONSTANTS.AGGREGATE_TYPE,
            TEST_CONSTANTS.AGGREGATE_ID,
          ),
        );
      });

      it("continues when event not yet processed", async () => {
        const eventStore = createMockEventStore<Event>();
        eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);
        eventStore.getEvents = vi.fn().mockResolvedValue([]);
        const checkpointStore = createMockCheckpointStore();
        checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
        checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);

        const validator = new ProjectionValidator({
          eventStore,
          aggregateType,
          checkpointStore: checkpointStore,
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        });

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        const result = await validator.validateEventProcessing(
          "processor",
          "handler",
          event,
          context,
        );

        expect(result).toBe(1);
      });
    });

    describe("failed events check", () => {
      it("returns null when previous events have failed", async () => {
        const eventStore = createMockEventStore<Event>();
        eventStore.countEventsBefore = vi.fn().mockResolvedValue(1);
        eventStore.getEvents = vi.fn().mockResolvedValue([]);
        const checkpointStore = createMockCheckpointStore();
        checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
        checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(true);

        const validator = new ProjectionValidator({
          eventStore,
          aggregateType,
          checkpointStore: checkpointStore,
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        });

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
          EVENT_TYPES[0],
          TEST_CONSTANTS.BASE_TIMESTAMP + 1000,
        );

        const result = await validator.validateEventProcessing(
          "processor",
          "handler",
          event,
          context,
        );

        expect(result).toBeNull();
        expect(checkpointStore.hasFailedEvents).toHaveBeenCalledWith(
          TEST_CONSTANTS.PIPELINE_NAME,
          "processor",
          "handler",
          tenantId,
          aggregateType,
          TEST_CONSTANTS.AGGREGATE_ID,
        );
      });
    });

    describe("sequential ordering validation", () => {
      it("throws when earlier event has not been processed", async () => {
        const eventStore = createMockEventStore<Event>();
        const earlierEvent = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
          EVENT_TYPES[0],
          TEST_CONSTANTS.BASE_TIMESTAMP,
        );
        const laterEvent = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
          EVENT_TYPES[0],
          TEST_CONSTANTS.BASE_TIMESTAMP + 1000,
        );

        eventStore.countEventsBefore = vi
          .fn()
          .mockImplementation(
            (aggregateId, ctx, aggType, timestamp, eventId) => {
              // For laterEvent: 1 event before it (earlierEvent), so sequence = 2
              if (eventId === laterEvent.id) {
                return Promise.resolve(1);
              }
              // For earlierEvent: no events before it, so sequence = 1
              if (eventId === earlierEvent.id) {
                return Promise.resolve(0);
              }
              return Promise.resolve(0);
            },
          );
        eventStore.getEvents = vi
          .fn()
          .mockResolvedValue([earlierEvent, laterEvent]);

        const checkpointStore = createMockCheckpointStore();
        checkpointStore.loadCheckpoint = vi
          .fn()
          .mockImplementation((processorName, processorType, eventId) => {
            // laterEvent not processed
            if (eventId === laterEvent.id) {
              return Promise.resolve(null);
            }
            // earlierEvent not processed
            if (eventId === earlierEvent.id) {
              return Promise.resolve(null);
            }
            return Promise.resolve(null);
          });
        checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);

        const validator = new ProjectionValidator({
          eventStore,
          aggregateType,
          checkpointStore: checkpointStore,
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        });

        await expect(
          validator.validateEventProcessing(
            "processor",
            "handler",
            laterEvent,
            context,
          ),
        ).rejects.toThrow(
          "Previous event (sequence 1) has not been processed yet",
        );
      });

      it("allows processing when earlier events are processed", async () => {
        const eventStore = createMockEventStore<Event>();
        const earlierEvent = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
          EVENT_TYPES[0],
          TEST_CONSTANTS.BASE_TIMESTAMP,
        );
        const laterEvent = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
          EVENT_TYPES[0],
          TEST_CONSTANTS.BASE_TIMESTAMP + 1000,
        );

        let callCount = 0;
        eventStore.countEventsBefore = vi
          .fn()
          .mockImplementation(
            (aggregateId, ctx, aggType, timestamp, eventId) => {
              callCount++;
              // First call: compute sequence for laterEvent (1 event before it, so sequence = 2)
              if (callCount === 1 && eventId === laterEvent.id) {
                return Promise.resolve(1);
              }
              // Subsequent calls: compute sequence for earlierEvent when checking ordering
              // (no events before it, so sequence = 1)
              if (eventId === earlierEvent.id) {
                return Promise.resolve(0);
              }
              // For laterEvent in subsequent calls (shouldn't happen, but handle it)
              if (eventId === laterEvent.id) {
                return Promise.resolve(1);
              }
              return Promise.resolve(0);
            },
          );
        eventStore.getEvents = vi
          .fn()
          .mockResolvedValue([earlierEvent, laterEvent]);

        const checkpointStore = createMockCheckpointStore();
        checkpointStore.loadCheckpoint = vi
          .fn()
          .mockImplementation((checkpointKey: string) => {
            // Both earlierEvent and laterEvent share the same checkpoint key (per-aggregate checkpoints).
            // The checkpoint represents the last processed event for the aggregate.
            // Since earlierEvent (sequence 1) was processed, return a checkpoint showing sequence 1.
            // Note: getCheckpointBySequenceNumber handles predecessor checks for ordering validation.
            if (
              checkpointKey ===
              buildCheckpointKey(
                tenantId,
                TEST_CONSTANTS.PIPELINE_NAME,
                "processor",
                TEST_CONSTANTS.AGGREGATE_TYPE,
                TEST_CONSTANTS.AGGREGATE_ID,
              )
            ) {
              return Promise.resolve({
                status: "processed",
                sequenceNumber: 1,
              });
            }
            return Promise.resolve(null);
          });
        checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);
        // Mock getCheckpointBySequenceNumber to return the processed earlierEvent
        // when checking for sequence 1 (the immediate predecessor of sequence 2)
        checkpointStore.getCheckpointBySequenceNumber = vi
          .fn()
          .mockResolvedValue({
            processorName: "processor",
            processorType: "handler",
            eventId: earlierEvent.id,
            status: "processed",
            sequenceNumber: 1,
            eventTimestamp: earlierEvent.timestamp,
            processedAt: Date.now(),
            tenantId: tenantId,
            aggregateType: aggregateType,
            aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          });

        const validator = new ProjectionValidator({
          eventStore,
          aggregateType,
          checkpointStore: checkpointStore,
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        });

        const result = await validator.validateEventProcessing(
          "processor",
          "handler",
          laterEvent,
          context,
        );

        expect(result).toBe(2);
      });

      it("allows sequence number 1 even when earlier events exist (only checks immediate predecessor)", async () => {
        const eventStore = createMockEventStore<Event>();
        const earlierEvent = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
          EVENT_TYPES[0],
          TEST_CONSTANTS.BASE_TIMESTAMP - 1000, // Earlier timestamp
        );
        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
          EVENT_TYPES[0],
          TEST_CONSTANTS.BASE_TIMESTAMP,
        );

        // event has sequence 1 (no events before it by count)
        eventStore.countEventsBefore = vi.fn().mockResolvedValueOnce(0); // event sequence = 1
        eventStore.getEvents = vi.fn().mockResolvedValue([earlierEvent, event]);

        const checkpointStore = createMockCheckpointStore();
        checkpointStore.loadCheckpoint = vi.fn().mockResolvedValueOnce(null); // event not processed
        checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);
        checkpointStore.getCheckpointBySequenceNumber = vi
          .fn()
          .mockResolvedValue(null);

        const validator = new ProjectionValidator({
          eventStore,
          aggregateType,
          checkpointStore: checkpointStore,
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        });

        // Sequence 1 has no predecessor, so ordering validation passes
        // even if earlier events exist (we only check immediate predecessor)
        const result = await validator.validateEventProcessing(
          "processor",
          "handler",
          event,
          context,
        );
        expect(result).toBe(1);
      });
    });

    describe("error handling", () => {
      it("throws when sequence number computation fails", async () => {
        const eventStore = createMockEventStore<Event>();
        eventStore.countEventsBefore = vi
          .fn()
          .mockRejectedValue(new Error("Database error"));

        const validator = new ProjectionValidator({
          eventStore,
          aggregateType,
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        });

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        await expect(
          validator.validateEventProcessing(
            "processor",
            "handler",
            event,
            context,
          ),
        ).rejects.toThrow("Database error");
      });
    });
  });
});
