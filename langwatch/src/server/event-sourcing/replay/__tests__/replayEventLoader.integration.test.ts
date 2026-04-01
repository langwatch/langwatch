import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  discoverAffectedAggregates,
  countEventsForAggregates,
  batchGetCutoffEventIds,
  batchLoadAggregateEvents,
} from "../replayEventLoader";
import {
  startTestContainers,
  stopTestContainers,
  getTestClickHouseClient,
} from "../../__tests__/integration/testContainers";
import { generateTestTenantId } from "../../__tests__/integration/testHelpers";

describe("replayEventLoader", () => {
  let tenantId: string;

  beforeAll(async () => {
    await startTestContainers();
    tenantId = generateTestTenantId();

    const client = getTestClickHouseClient()!;

    // Insert test events into event_log
    const events = [
      {
        TenantId: tenantId,
        AggregateType: "test",
        AggregateId: "agg-1",
        EventId: "evt-001",
        EventType: "test.event",
        EventTimestamp: 1700000000000,
        EventOccurredAt: 1700000000000,
        EventVersion: "2025-01-01",
        EventPayload: JSON.stringify({ value: 10 }),
      },
      {
        TenantId: tenantId,
        AggregateType: "test",
        AggregateId: "agg-1",
        EventId: "evt-002",
        EventType: "test.event",
        EventTimestamp: 1700000001000,
        EventOccurredAt: 1700000001000,
        EventVersion: "2025-01-01",
        EventPayload: JSON.stringify({ value: 20 }),
      },
      {
        TenantId: tenantId,
        AggregateType: "test",
        AggregateId: "agg-2",
        EventId: "evt-003",
        EventType: "test.event",
        EventTimestamp: 1700000002000,
        EventOccurredAt: 1700000002000,
        EventVersion: "2025-01-01",
        EventPayload: JSON.stringify({ value: 30 }),
      },
    ];

    await client.insert({
      table: "event_log",
      values: events,
      format: "JSONEachRow",
    });
  });

  afterAll(async () => {
    const client = getTestClickHouseClient();
    if (client) {
      await client.exec({
        query: `ALTER TABLE event_log DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
    await stopTestContainers();
  });

  describe("discoverAffectedAggregates", () => {
    it("discovers aggregates with events since timestamp", async () => {
      const client = getTestClickHouseClient()!;
      const aggregates = await discoverAffectedAggregates({
        client,
        eventTypes: ["test.event"],
        sinceMs: 1700000000000,
        tenantId,
      });

      expect(aggregates).toHaveLength(2);
      expect(aggregates.map((a) => a.aggregateId).sort()).toEqual([
        "agg-1",
        "agg-2",
      ]);
    });

    describe("when filtering by tenant", () => {
      it("returns only matching tenant aggregates", async () => {
        const client = getTestClickHouseClient()!;
        const aggregates = await discoverAffectedAggregates({
          client,
          eventTypes: ["test.event"],
          sinceMs: 1700000000000,
          tenantId: "nonexistent-tenant",
        });

        expect(aggregates).toHaveLength(0);
      });
    });

    describe("when sinceMs is after all events", () => {
      it("returns no aggregates", async () => {
        const client = getTestClickHouseClient()!;
        const aggregates = await discoverAffectedAggregates({
          client,
          eventTypes: ["test.event"],
          sinceMs: 1800000000000,
          tenantId,
        });

        expect(aggregates).toHaveLength(0);
      });
    });
  });

  describe("countEventsForAggregates", () => {
    it("counts all events for discovered aggregates", async () => {
      const client = getTestClickHouseClient()!;
      const count = await countEventsForAggregates({
        client,
        eventTypes: ["test.event"],
        sinceMs: 1700000000000,
        tenantId,
      });

      expect(count).toBe(3);
    });

    describe("when no events match", () => {
      it("returns zero", async () => {
        const client = getTestClickHouseClient()!;
        const count = await countEventsForAggregates({
          client,
          eventTypes: ["nonexistent.event"],
          sinceMs: 1700000000000,
          tenantId,
        });

        expect(count).toBe(0);
      });
    });
  });

  describe("batchGetCutoffEventIds", () => {
    it("returns cutoff info per aggregate", async () => {
      const client = getTestClickHouseClient()!;
      const cutoffs = await batchGetCutoffEventIds({
        client,
        tenantId,
        aggregateIds: ["agg-1", "agg-2"],
        eventTypes: ["test.event"],
      });

      expect(cutoffs.size).toBe(2);

      const agg1Cutoff = cutoffs.get(`${tenantId}:test:agg-1`);
      expect(agg1Cutoff).toBeDefined();
      expect(agg1Cutoff!.eventId).toBe("evt-002"); // Last event for agg-1
      expect(agg1Cutoff!.timestamp).toBe(1700000001000);

      const agg2Cutoff = cutoffs.get(`${tenantId}:test:agg-2`);
      expect(agg2Cutoff).toBeDefined();
      expect(agg2Cutoff!.eventId).toBe("evt-003");
      expect(agg2Cutoff!.timestamp).toBe(1700000002000);
    });

    describe("when aggregate has no events", () => {
      it("omits that aggregate from the map", async () => {
        const client = getTestClickHouseClient()!;
        const cutoffs = await batchGetCutoffEventIds({
          client,
          tenantId,
          aggregateIds: ["nonexistent-agg"],
          eventTypes: ["test.event"],
        });

        expect(cutoffs.size).toBe(0);
      });
    });
  });

  describe("batchLoadAggregateEvents", () => {
    it("loads events up to cutoff", async () => {
      const client = getTestClickHouseClient()!;
      const events = await batchLoadAggregateEvents({
        client,
        tenantId,
        aggregateIds: ["agg-1"],
        eventTypes: ["test.event"],
        maxCutoffEventId: "evt-002",
        cursorEventId: "",
        batchSize: 100,
      });

      expect(events).toHaveLength(2);
      expect(events[0]!.id).toBe("evt-001");
      expect(events[1]!.id).toBe("evt-002");
      expect(events[0]!.data).toEqual({ value: 10 });
      expect(events[1]!.data).toEqual({ value: 20 });
    });

    it("parses event payload into data field", async () => {
      const client = getTestClickHouseClient()!;
      const events = await batchLoadAggregateEvents({
        client,
        tenantId,
        aggregateIds: ["agg-2"],
        eventTypes: ["test.event"],
        maxCutoffEventId: "evt-003",
        cursorEventId: "",
        batchSize: 100,
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.data).toEqual({ value: 30 });
      expect(events[0]!.aggregateId).toBe("agg-2");
      expect(events[0]!.tenantId).toBe(tenantId);
    });

    describe("when using cursor pagination", () => {
      it("returns events after cursor", async () => {
        const client = getTestClickHouseClient()!;
        const events = await batchLoadAggregateEvents({
          client,
          tenantId,
          aggregateIds: ["agg-1"],
          eventTypes: ["test.event"],
          maxCutoffEventId: "evt-002",
          cursorEventId: "evt-001",
          batchSize: 100,
        });

        expect(events).toHaveLength(1);
        expect(events[0]!.id).toBe("evt-002");
      });
    });

    describe("when batchSize limits results", () => {
      it("returns at most batchSize events", async () => {
        const client = getTestClickHouseClient()!;
        const events = await batchLoadAggregateEvents({
          client,
          tenantId,
          aggregateIds: ["agg-1"],
          eventTypes: ["test.event"],
          maxCutoffEventId: "evt-002",
          cursorEventId: "",
          batchSize: 1,
        });

        expect(events).toHaveLength(1);
        expect(events[0]!.id).toBe("evt-001");
      });
    });
  });
});
