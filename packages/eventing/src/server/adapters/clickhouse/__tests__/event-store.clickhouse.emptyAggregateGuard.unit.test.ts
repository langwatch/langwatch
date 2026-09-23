import { type AggregateType, createTenantId, type Event } from "@langwatch/eventing";
import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
  type EventingClickHouseClient,
} from "@langwatch/eventing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `AggregateId = ''` seeks the key range holding every no-aggregate-id event
 * ever written, which can exceed `max_memory_usage_per_query` in prod (Code
 * 241). No aggregate type uses an empty id, so the store short-circuits it.
 */
describe("EventStoreClickHouse - empty aggregateId guard", () => {
  const tenantId = createTenantId("test-tenant");
  const aggregateType: AggregateType = "trace";

  let mockClickHouseClient: EventingClickHouseClient;
  let store: EventingClickHouseEventStore;

  beforeEach(() => {
    mockClickHouseClient = {
      query: vi.fn(),
      insert: vi.fn(),
    };

    const retention = createEventingRetentionConfiguration({ defaultRetentionDays: 49 });
    store = EventingClickHouseEventStore.create({
      repository: EventingClickHouseEventRepository.create({
        resolveClient: async () => mockClickHouseClient,
        retention,
      }),
      retention,
    });
  });

  const upToEvent: Event = {
    id: "event-1",
    aggregateId: "trace-123",
    aggregateType,
    tenantId,
    createdAt: 1000,
    occurredAt: 1000,
    type: "test.event",
    version: "2025-12-17",
    data: {},
  };

  describe.each([
    { label: "an empty aggregateId", aggregateId: "" },
    { label: "a whitespace-only aggregateId", aggregateId: "   " },
  ])("given $label", ({ aggregateId }) => {
    describe("when getEvents is called", () => {
      it("returns no events without touching ClickHouse", async () => {
        const events = await store.getEvents(aggregateId, { tenantId }, aggregateType);

        expect(events).toEqual([]);
        expect(mockClickHouseClient.query).not.toHaveBeenCalled();
      });
    });

    describe("when getEventsUpTo is called", () => {
      it("returns no events without touching ClickHouse", async () => {
        const events = await store.getEventsUpTo(
          aggregateId,
          { tenantId },
          aggregateType,
          upToEvent,
        );

        expect(events).toEqual([]);
        expect(mockClickHouseClient.query).not.toHaveBeenCalled();
      });
    });

    describe("when countEventsBefore is called", () => {
      it("returns 0 without touching ClickHouse", async () => {
        const count = await store.countEventsBefore(
          aggregateId,
          { tenantId },
          aggregateType,
          1000,
          "event-1",
        );

        expect(count).toBe(0);
        expect(mockClickHouseClient.query).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a real aggregateId", () => {
    describe("when getEvents is called", () => {
      it("issues the event_log read", async () => {
        (mockClickHouseClient.query as ReturnType<typeof vi.fn>).mockResolvedValue({
          json: vi.fn().mockResolvedValue([]),
        });

        await store.getEvents("trace-123", { tenantId }, aggregateType);

        expect(mockClickHouseClient.query).toHaveBeenCalledWith(
          expect.objectContaining({
            query_params: expect.objectContaining({ aggregateId: "trace-123" }),
          }),
        );
      });
    });
  });
});
