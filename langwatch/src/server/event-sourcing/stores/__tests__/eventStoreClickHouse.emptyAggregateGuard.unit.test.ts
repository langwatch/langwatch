import type { ClickHouseClient } from "@clickhouse/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregateType } from "../../";
import { createTenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import { EventStoreClickHouse } from "../eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../repositories/eventRepositoryClickHouse";

/**
 * `event_log` is `ORDER BY (TenantId, AggregateType, AggregateId, IdempotencyKey)`.
 * A read with `AggregateId = ''` seeks to the empty-id key range, which holds
 * every event ever written without an aggregate id, and materialises all their
 * `EventPayload` blobs — in prod this exceeds `max_memory_usage_per_query`
 * (Code 241) and degrades the whole instance. No aggregate type uses an empty
 * id, so the store must short-circuit such reads instead of issuing them.
 */
describe("EventStoreClickHouse - empty aggregateId guard", () => {
  const tenantId = createTenantId("test-tenant");
  const aggregateType: AggregateType = "trace";

  let mockClickHouseClient: ClickHouseClient;
  let store: EventStoreClickHouse;

  beforeEach(() => {
    mockClickHouseClient = {
      query: vi.fn(),
    } as unknown as ClickHouseClient;

    store = new EventStoreClickHouse(
      new EventRepositoryClickHouse(async () => mockClickHouseClient),
    );
  });

  const upToEvent = {
    id: "event-1",
    createdAt: 1000,
  } as unknown as Event;

  describe("given an empty aggregateId", () => {
    it("getEvents returns no events without touching ClickHouse", async () => {
      const events = await store.getEvents("", { tenantId }, aggregateType);

      expect(events).toEqual([]);
      expect(mockClickHouseClient.query).not.toHaveBeenCalled();
    });

    it("getEventsUpTo returns no events without touching ClickHouse", async () => {
      const events = await store.getEventsUpTo(
        "",
        { tenantId },
        aggregateType,
        upToEvent,
      );

      expect(events).toEqual([]);
      expect(mockClickHouseClient.query).not.toHaveBeenCalled();
    });

    it("countEventsBefore returns 0 without touching ClickHouse", async () => {
      const count = await store.countEventsBefore(
        "",
        { tenantId },
        aggregateType,
        1000,
        "event-1",
      );

      expect(count).toBe(0);
      expect(mockClickHouseClient.query).not.toHaveBeenCalled();
    });
  });

  describe("given a whitespace-only aggregateId", () => {
    it("getEvents still short-circuits without touching ClickHouse", async () => {
      const events = await store.getEvents("   ", { tenantId }, aggregateType);

      expect(events).toEqual([]);
      expect(mockClickHouseClient.query).not.toHaveBeenCalled();
    });
  });

  describe("given a real aggregateId", () => {
    it("getEvents issues the event_log read", async () => {
      (
        mockClickHouseClient.query as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ json: vi.fn().mockResolvedValue([]) });

      await store.getEvents("trace-123", { tenantId }, aggregateType);

      expect(mockClickHouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query_params: expect.objectContaining({ aggregateId: "trace-123" }),
        }),
      );
    });
  });
});
