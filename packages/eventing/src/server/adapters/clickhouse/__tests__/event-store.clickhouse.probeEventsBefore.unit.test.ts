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

  type ReadRequest = Parameters<EventingClickHouseClient["read"]>[0];
  let read: ReturnType<typeof vi.fn<(request: ReadRequest) => Promise<{ rows: unknown[] }>>>;

  /** Answers the event check, then the earlier-events check, with a row when it holds one. */
  function answer({
    hasEvent,
    hasEarlierEvents,
  }: {
    hasEvent: boolean;
    hasEarlierEvents: boolean;
  }) {
    read.mockImplementation(async ({ statement }) => {
      const earlierCheck = statement.sql.includes("EventTimestamp <");
      const holds = earlierCheck ? hasEarlierEvents : hasEvent;
      return { rows: holds ? [{ EventId: "event-1" }] : [] };
    });
  }

  beforeEach(() => {
    read = vi.fn(async () => ({ rows: [] }));
    client = { read: read as EventingClickHouseClient["read"], insert: vi.fn() };
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
    it("answers both facts from two LIMIT 1 checks of the tenant's built reads", async () => {
      answer({ hasEvent: true, hasEarlierEvents: true });

      const probe = await store.probeEventsBefore({
        aggregateId,
        context: { tenantId },
        aggregateType: "coding_agent_session",
        event: eventOf("coding_agent_session"),
      });

      expect(probe).toEqual({ hasEvent: true, hasEarlierEvents: true });
      expect(read).toHaveBeenCalledTimes(2);
      const [event, earlier] = read.mock.calls.map(([request]) => request.statement);
      for (const statement of [event!, earlier!]) {
        expect(statement.sql).toContain("FROM event_log WHERE TenantId = {tenantId:String}");
        expect(statement.sql).toMatch(/LIMIT 1$/);
        expect(statement.params).toMatchObject({ tenantId });
        expect(Object.values(statement.params)).toEqual(
          expect.arrayContaining([aggregateId, "event-2"]),
        );
      }
      expect(event!.sql).toMatch(/EventId = \{v\d+:String\}/);
      expect(earlier!.sql).toMatch(/EventTimestamp < \{v\d+:UInt64\}/);
      expect(Object.values(earlier!.params)).toContain(occurredAt + 5);
    });
  });

  describe("given a replica that holds neither", () => {
    it("answers that it shows nothing", async () => {
      answer({ hasEvent: false, hasEarlierEvents: false });

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
      answer({ hasEvent: true, hasEarlierEvents: false });

      await store.probeEventsBefore({
        aggregateId,
        context: { tenantId },
        aggregateType: "trace",
        event: eventOf("trace"),
      });

      for (const [request] of read.mock.calls) {
        expect(request.statement.sql).toMatch(/EventOccurredAt >= \{v\d+:\w+\}/);
        expect(request.declaresFullScan).toBeUndefined();
      }
    });
  });
});
