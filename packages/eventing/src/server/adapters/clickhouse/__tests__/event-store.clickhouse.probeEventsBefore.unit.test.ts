import { type AggregateType, createTenantId, type Event } from "@langwatch/eventing";
import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
  type EventingClickHouseClient,
} from "@langwatch/eventing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The event-log probe a fold asks after a store miss: whether the replica holds the delivered
 * event and anything accepted before it, each answered by a LIMIT 1 existence check.
 */
describe("EventStoreClickHouse probeEventsBefore", () => {
  const tenantId = createTenantId("test-tenant");
  const aggregateId = "test-aggregate";
  const occurredAt = 1_700_000_000_000;

  let client: EventingClickHouseClient;
  let store: EventingClickHouseEventStore;

  function eventOf(aggregateType: AggregateType): Event {
    return {
      id: "event-2",
      aggregateId,
      aggregateType,
      tenantId,
      createdAt: occurredAt + 5,
      occurredAt,
      version: "2025-12-17",
      type: "lw.test.event",
      data: {},
    } as Event;
  }

  function answer(row: Record<string, unknown>) {
    (client.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: vi.fn().mockResolvedValue([row]),
    });
  }

  beforeEach(() => {
    client = { query: vi.fn(), insert: vi.fn() };
    const retention = createEventingRetentionConfiguration({ defaultRetentionDays: 49 });
    store = EventingClickHouseEventStore.create({
      repository: EventingClickHouseEventRepository.create({
        resolveClient: async () => client,
        retention,
      }),
      retention,
    });
  });

  describe("given a replica that holds the event and an earlier one", () => {
    it("answers both facts from one statement of two LIMIT 1 checks", async () => {
      answer({ hasEvent: "1", hasEarlierEvents: "1" });

      const probe = await store.probeEventsBefore({
        aggregateId,
        context: { tenantId },
        aggregateType: "coding_agent_session",
        event: eventOf("coding_agent_session"),
      });

      expect(probe).toEqual({ hasEvent: true, hasEarlierEvents: true });
      expect(client.query).toHaveBeenCalledTimes(1);
      const request = vi.mocked(client.query).mock.calls[0]![0];
      expect(request.query.match(/LIMIT 1/g)).toHaveLength(2);
      expect(request.query).toContain("EventId = {eventId:String}");
      expect(request.query).toContain("EventTimestamp < {eventTimestamp:UInt64}");
      expect(request.query_params).toEqual(
        expect.objectContaining({
          tenantId,
          aggregateId,
          eventTimestamp: occurredAt + 5,
          eventId: "event-2",
        }),
      );
    });
  });

  describe("given a replica that holds neither", () => {
    it("answers that it shows nothing", async () => {
      answer({ hasEvent: "0", hasEarlierEvents: "0" });

      const probe = await store.probeEventsBefore({
        aggregateId,
        context: { tenantId },
        aggregateType: "coding_agent_session",
        event: eventOf("coding_agent_session"),
      });

      expect(probe).toEqual({ hasEvent: false, hasEarlierEvents: false });
    });
  });

  describe("given a time-local aggregate", () => {
    it("bounds the probe to the partitions the store-miss re-fold would read", async () => {
      answer({ hasEvent: 1, hasEarlierEvents: 0 });

      await store.probeEventsBefore({
        aggregateId,
        context: { tenantId },
        aggregateType: "trace",
        event: eventOf("trace"),
      });

      const request = vi.mocked(client.query).mock.calls[0]![0];
      expect(request.query).toContain("EventOccurredAt >= {occurredAtFromMs:UInt64}");
      expect(request.query_params).toHaveProperty("occurredAtFromMs");
      expect(request.SKIP_COLD_SCAN_CHECK).toBeUndefined();
    });
  });
});
