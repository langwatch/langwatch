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

  describe.each([
    { label: "an empty aggregateId", aggregateId: "" },
    { label: "a whitespace-only aggregateId", aggregateId: "   " },
  ])("given $label", ({ aggregateId }) => {
    describe("when getEvents is called", () => {
      it("returns no events without touching ClickHouse", async () => {
        const events = await store.getEvents(
          aggregateId,
          { tenantId },
          aggregateType,
        );

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
});
