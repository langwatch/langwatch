import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../../services/eventSourcingService";
import {
  createMockEventStore,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import type { EventSubscriberDefinition } from "../eventSubscriber.types";

describe("event subscribers", () => {
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

  describe("given an event was durably stored", () => {
    describe("when a matching subscriber handles it inline", () => {
      it("receives the event envelope without loading the event log or a fold", async () => {
        const eventStore = createMockEventStore<Event>();
        const handle = vi.fn().mockResolvedValue(void 0);
        const subscriber: EventSubscriberDefinition<Event> = {
          name: "conversationProcess",
          eventTypes: [],
          handle,
        };
        const service = new EventSourcingService({
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
          aggregateType,
          eventStore,
          subscribers: [subscriber],
        });
        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        await service.storeEvents([event], context);

        expect(eventStore.storeEvents).toHaveBeenCalledWith(
          [event],
          context,
          aggregateType,
        );
        expect(eventStore.getEvents).not.toHaveBeenCalled();
        expect(eventStore.getEventsUpTo).not.toHaveBeenCalled();
        expect(handle).toHaveBeenCalledWith(event, {
          tenantId,
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        });
      });
    });
  });

  describe("given a subscriber selects specific event types", () => {
    describe("when a different event is stored", () => {
      it("does not invoke the subscriber", async () => {
        const eventStore = createMockEventStore<Event>();
        const handle = vi.fn().mockResolvedValue(void 0);
        const subscriber: EventSubscriberDefinition<Event> = {
          name: "startedTurnsOnly",
          eventTypes: ["lw.test.started"],
          handle,
        };
        const service = new EventSourcingService({
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
          aggregateType,
          eventStore,
          subscribers: [subscriber],
        });
        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        await service.storeEvents([event], context);

        expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
        expect(handle).not.toHaveBeenCalled();
      });
    });
  });
});
