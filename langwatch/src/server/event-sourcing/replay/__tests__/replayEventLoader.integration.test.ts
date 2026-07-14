import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  discoverAffectedAggregates,
  countEventsForAggregates,
  batchGetCutoffEventIds,
  batchLoadAggregateEvents,
  getAggregateOccurredAtBounds,
  getBoundedCutoffs,
  loadEventsForAggregatesBulk,
} from "../replayEventLoader";
import {
  startTestContainers,
  stopTestContainers,
  getTestClickHouseClient,
} from "../../__tests__/integration/testContainers";
import { generateTestTenantId } from "../../__tests__/integration/testHelpers";

describe("replayEventLoader", () => {
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    await startTestContainers();
    tenantId = generateTestTenantId();
    otherTenantId = generateTestTenantId();

    const client = getTestClickHouseClient()!;

    // Insert test events into event_log.
    // IdempotencyKey must be unique per event — event_log is a ReplacingMergeTree
    // keyed by (TenantId, AggregateType, AggregateId, IdempotencyKey), so events
    // sharing that tuple get collapsed to a single row on merge.
    const events = [
      {
        TenantId: tenantId,
        AggregateType: "test",
        AggregateId: "agg-1",
        IdempotencyKey: "evt-001",
        EventId: "evt-001",
        EventType: "test.event",
        EventTimestamp: 1700000000000,
        EventOccurredAt: 1700000000000,
        EventVersion: "2025-01-01",
        EventPayload: JSON.stringify({ value: 10 }),
        // Backdated fixture (Nov 2023). Stamp the never-expire sentinel so the
        // retention TTL doesn't immediately delete the seed rows on next merge.
        _retention_days: 0,
      },
      {
        TenantId: tenantId,
        AggregateType: "test",
        AggregateId: "agg-1",
        IdempotencyKey: "evt-002",
        EventId: "evt-002",
        EventType: "test.event",
        EventTimestamp: 1700000001000,
        EventOccurredAt: 1700000001000,
        EventVersion: "2025-01-01",
        EventPayload: JSON.stringify({ value: 20 }),
        _retention_days: 0,
      },
      {
        TenantId: tenantId,
        AggregateType: "test",
        AggregateId: "agg-2",
        IdempotencyKey: "evt-003",
        EventId: "evt-003",
        EventType: "test.event",
        EventTimestamp: 1700000002000,
        EventOccurredAt: 1700000002000,
        EventVersion: "2025-01-01",
        EventPayload: JSON.stringify({ value: 30 }),
        _retention_days: 0,
      },
      // Second tenant with colliding aggregate ID to verify tenant isolation
      {
        TenantId: otherTenantId,
        AggregateType: "test",
        AggregateId: "agg-1",
        IdempotencyKey: "evt-other-001",
        EventId: "evt-other-001",
        EventType: "test.event",
        EventTimestamp: 1700000000500,
        EventOccurredAt: 1700000000500,
        EventVersion: "2025-01-01",
        EventPayload: JSON.stringify({ value: 999 }),
        _retention_days: 0,
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
        query: `ALTER TABLE event_log DELETE WHERE TenantId IN ({tenantId:String}, {otherTenantId:String})`,
        query_params: { tenantId, otherTenantId },
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

    describe("when another tenant has the same aggregateId", () => {
      it("returns only the requested tenant's events", async () => {
        const client = getTestClickHouseClient()!;
        const events = await batchLoadAggregateEvents({
          client,
          tenantId,
          aggregateIds: ["agg-1"],
          eventTypes: ["test.event"],
          maxCutoffEventId: "zzz",
          cursorEventId: "",
          batchSize: 100,
        });

        // Only tenant's events, not otherTenantId's evt-other-001
        expect(events.every((e) => e.tenantId === tenantId)).toBe(true);
        expect(events).toHaveLength(2);
      });
    });
  });

  describe("tenant isolation across queries", () => {
    it("batchGetCutoffEventIds excludes other tenant's events", async () => {
      const client = getTestClickHouseClient()!;
      const cutoffs = await batchGetCutoffEventIds({
        client,
        tenantId,
        aggregateIds: ["agg-1"],
        eventTypes: ["test.event"],
      });

      const cutoff = cutoffs.get(`${tenantId}:test:agg-1`);
      expect(cutoff).toBeDefined();
      // Must be evt-002 (tenant's last), not evt-other-001 (other tenant's)
      expect(cutoff!.eventId).toBe("evt-002");
    });
  });

  describe("getAggregateOccurredAtBounds", () => {
    it("returns the occurred-at range covering every event of the aggregates", async () => {
      const client = getTestClickHouseClient()!;
      const bounds = await getAggregateOccurredAtBounds({
        client,
        tenantId,
        aggregateTypes: ["test"],
        aggregateIds: ["agg-1", "agg-2"],
      });

      expect(bounds).toEqual({ minMs: 1700000000000, maxMs: 1700000002000 });
    });

    describe("when the aggregates have no events", () => {
      it("returns undefined", async () => {
        const client = getTestClickHouseClient()!;
        const bounds = await getAggregateOccurredAtBounds({
          client,
          tenantId,
          aggregateTypes: ["test"],
          aggregateIds: ["nonexistent-agg"],
        });

        expect(bounds).toBeUndefined();
      });
    });

    describe("when the aggregate id list is empty", () => {
      it("returns undefined without querying", async () => {
        const client = getTestClickHouseClient()!;
        const querySpy = vi.spyOn(client, "query");
        try {
          const bounds = await getAggregateOccurredAtBounds({
            client,
            tenantId,
            aggregateTypes: ["test"],
            aggregateIds: [],
          });

          expect(bounds).toBeUndefined();
          expect(querySpy).not.toHaveBeenCalled();
        } finally {
          querySpy.mockRestore();
        }
      });
    });
  });

  describe("getBoundedCutoffs", () => {
    it("returns cutoffs and the occurred-at bounds they were computed under", async () => {
      const client = getTestClickHouseClient()!;
      const { cutoffs, occurredAtBounds } = await getBoundedCutoffs({
        client,
        tenantId,
        aggregateTypes: ["test"],
        aggregateIds: ["agg-1", "agg-2"],
        eventTypes: ["test.event"],
      });

      expect(occurredAtBounds).toEqual({ minMs: 1700000000000, maxMs: 1700000002000 });
      expect(cutoffs.get(`${tenantId}:test:agg-1`)).toEqual({
        timestamp: 1700000001000,
        eventId: "evt-002",
      });
      expect(cutoffs.get(`${tenantId}:test:agg-2`)).toEqual({
        timestamp: 1700000002000,
        eventId: "evt-003",
      });
    });

    describe("when the aggregates have no events", () => {
      it("short-circuits with empty cutoffs and skips the cutoff query", async () => {
        const client = getTestClickHouseClient()!;
        const querySpy = vi.spyOn(client, "query");
        try {
          const { cutoffs, occurredAtBounds } = await getBoundedCutoffs({
            client,
            tenantId,
            aggregateTypes: ["test"],
            aggregateIds: ["nonexistent-agg"],
            eventTypes: ["test.event"],
          });

          expect(occurredAtBounds).toBeUndefined();
          expect(cutoffs.size).toBe(0);
          // Only the bounds query ran — the unbounded cutoff query was skipped.
          expect(querySpy).toHaveBeenCalledTimes(1);
        } finally {
          querySpy.mockRestore();
        }
      });
    });
  });

  describe("when occurred-at bounds prune the queries", () => {
    // The bounds come from getAggregateOccurredAtBounds over the same
    // aggregates, so the bounded queries must return exactly what the
    // unbounded ones do — pruning is a partition optimisation, never a
    // result filter.
    it("batchGetCutoffEventIds returns the same cutoffs as unbounded", async () => {
      const client = getTestClickHouseClient()!;
      const bounds = await getAggregateOccurredAtBounds({
        client,
        tenantId,
        aggregateTypes: ["test"],
        aggregateIds: ["agg-1", "agg-2"],
      });
      const bounded = await batchGetCutoffEventIds({
        client,
        tenantId,
        aggregateIds: ["agg-1", "agg-2"],
        eventTypes: ["test.event"],
        occurredAtBounds: bounds!,
      });
      const unbounded = await batchGetCutoffEventIds({
        client,
        tenantId,
        aggregateIds: ["agg-1", "agg-2"],
        eventTypes: ["test.event"],
      });

      expect(bounded).toEqual(unbounded);
      expect(bounded.get(`${tenantId}:test:agg-1`)!.eventId).toBe("evt-002");
    });

    it("batchLoadAggregateEvents returns the same events as unbounded", async () => {
      const client = getTestClickHouseClient()!;
      const bounds = await getAggregateOccurredAtBounds({
        client,
        tenantId,
        aggregateTypes: ["test"],
        aggregateIds: ["agg-1"],
      });
      const events = await batchLoadAggregateEvents({
        client,
        tenantId,
        aggregateIds: ["agg-1"],
        eventTypes: ["test.event"],
        maxCutoffEventId: "evt-002",
        cursorEventId: "",
        batchSize: 100,
        occurredAtBounds: bounds!,
      });

      expect(events.map((e) => e.id)).toEqual(["evt-001", "evt-002"]);
    });

    describe("when the bounds are deliberately narrower than the data", () => {
      // Bounds ending at 1700000001000 exclude agg-2's only event
      // (evt-003 at 1700000002000). Correct bounds never filter results,
      // so an exclusion here proves the predicate is actually wired into
      // the SQL -- guarding against the pruning being silently dropped.
      const narrowBounds = { minMs: 1700000000000, maxMs: 1700000001000 };

      it("batchGetCutoffEventIds excludes events outside the bounds", async () => {
        const client = getTestClickHouseClient()!;
        const cutoffs = await batchGetCutoffEventIds({
          client,
          tenantId,
          aggregateIds: ["agg-1", "agg-2"],
          eventTypes: ["test.event"],
          occurredAtBounds: narrowBounds,
        });

        expect(cutoffs.get(`${tenantId}:test:agg-1`)!.eventId).toBe("evt-002");
        expect(cutoffs.has(`${tenantId}:test:agg-2`)).toBe(false);
      });

      it("loadEventsForAggregatesBulk excludes events outside the bounds", async () => {
        const client = getTestClickHouseClient()!;
        const cutoffs = await batchGetCutoffEventIds({
          client,
          tenantId,
          aggregateIds: ["agg-1", "agg-2"],
          eventTypes: ["test.event"],
        });

        const bounded = await loadEventsForAggregatesBulk({
          client,
          tenantId,
          aggregateIds: ["agg-1", "agg-2"],
          cutoffs,
          occurredAtBounds: narrowBounds,
        });

        expect(bounded.get(`${tenantId}:test:agg-1`)?.map((e) => e.id)).toEqual(
          ["evt-001", "evt-002"],
        );
        expect(bounded.has(`${tenantId}:test:agg-2`)).toBe(false);
      });
    });

    it("loadEventsForAggregatesBulk returns the same events as unbounded", async () => {
      const client = getTestClickHouseClient()!;
      const bounds = await getAggregateOccurredAtBounds({
        client,
        tenantId,
        aggregateTypes: ["test"],
        aggregateIds: ["agg-1", "agg-2"],
      });
      const cutoffs = await batchGetCutoffEventIds({
        client,
        tenantId,
        aggregateIds: ["agg-1", "agg-2"],
        eventTypes: ["test.event"],
        occurredAtBounds: bounds!,
      });

      const bounded = await loadEventsForAggregatesBulk({
        client,
        tenantId,
        aggregateIds: ["agg-1", "agg-2"],
        cutoffs,
        occurredAtBounds: bounds!,
      });
      const unbounded = await loadEventsForAggregatesBulk({
        client,
        tenantId,
        aggregateIds: ["agg-1", "agg-2"],
        cutoffs,
      });

      expect(bounded.get(`${tenantId}:test:agg-1`)?.map((e) => e.id)).toEqual([
        "evt-001",
        "evt-002",
      ]);
      expect(bounded.get(`${tenantId}:test:agg-2`)?.map((e) => e.id)).toEqual([
        "evt-003",
      ]);
      expect([...bounded.keys()].sort()).toEqual([...unbounded.keys()].sort());
    });
  });
});
