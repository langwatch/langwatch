/**
 * ADR-202: every event_log read is a built statement on the reader identity. One aggregate's
 * reads carry `TenantId = {tenantId}` and that tenant as the setting; a read of many aggregates
 * declares its tenant set both ways. Caller values are bound, never spliced.
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import {
  aggregateEventsRead,
  aggregateEventsUpToRead,
  eventCountBeforeRead,
  eventRecordRead,
  eventsOfAggregatesRead,
} from "../event-log-reads.clickhouse.ts";

const KEY = { tenantId: "project_a", aggregateType: "trace", aggregateId: "agg-'1" };

function expectSingleTenant(statement: ReaderReadStatement) {
  expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId: "project_a" });
  expect(statement.tenantIds).toBeUndefined();
  expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project_a" });
  expect(statement.sql).toContain("FROM event_log WHERE TenantId = {tenantId:String}");
  expect(statement.params).toMatchObject({ tenantId: "project_a" });
  expect(Object.values(statement.params)).toEqual(
    expect.arrayContaining([KEY.aggregateType, KEY.aggregateId]),
  );
  expect(statement.sql).not.toContain("agg-'1");
}

describe("event_log reads", () => {
  describe("when one event is read by id", () => {
    it("reads the newest row of that event in the tenant, bounded by its window", () => {
      const { statement, ...rest } = eventRecordRead({
        ...KEY,
        eventId: "evt-1",
        window: { fromMs: 1_000, toMs: 2_000 },
      });

      expectSingleTenant(statement);
      expect(rest).toEqual({});
      expect(statement.sql).toContain("EventId = {v2:String}");
      expect(statement.sql).toMatch(
        /\(EventOccurredAt = \{v\d:UInt64\} OR \(EventOccurredAt >= \{v\d:UInt64\} AND EventOccurredAt <= \{v\d:UInt64\}\)\)/,
      );
      expect(statement.sql).toMatch(/ORDER BY EventTimestamp DESC LIMIT 1$/);
      expect(statement.params).toMatchObject({ v2: "evt-1", v3: 0, v4: 1_000, v5: 2_000 });
    });

    it("reads with no occurred-time predicate when no window is known", () => {
      const { statement } = eventRecordRead({ ...KEY, eventId: "evt-1", window: undefined });

      expectSingleTenant(statement);
      expect(statement.sql).not.toContain("EventOccurredAt =");
    });
  });

  describe("when one aggregate's events are read", () => {
    it("prunes by a positive lower bound and declares no full scan", () => {
      const read = aggregateEventsRead({ ...KEY, occurredAtFromMs: 5_000 });

      expectSingleTenant(read.statement);
      expect(read.declaresFullScan).toBeUndefined();
      expect(read.statement.sql).toMatch(
        /\(EventOccurredAt = \{v\d:UInt64\} OR EventOccurredAt >= \{v\d:UInt64\}\) ORDER BY EventTimestamp ASC, EventId ASC$/,
      );
      expect(Object.values(read.statement.params)).toContain(5_000);
    });

    it.each([undefined, 0])("declares a full scan of the history when the bound is %s", (bound) => {
      const read = aggregateEventsRead({ ...KEY, occurredAtFromMs: bound });

      expectSingleTenant(read.statement);
      expect(read.declaresFullScan).toBe(true);
      expect(read.statement.sql).not.toContain("EventOccurredAt =");
    });
  });

  describe("when many aggregates are read across tenants", () => {
    it("declares the tenant set in its predicate and its setting", () => {
      const read = eventsOfAggregatesRead({
        tenantIds: ["project_a", "project_c"],
        aggregateType: "trace",
        aggregateIds: ["agg-1", "agg-2"],
        occurredAtFromMs: undefined,
      });

      expect(read.statement).toMatchObject({
        identity: "reader",
        kind: "tenant",
        tenantId: "project_a",
        tenantIds: ["project_a", "project_c"],
      });
      expect(read.statement.settings).toMatchObject({
        SQL_langwatch_tenant_ids: "project_a,project_c",
      });
      expect(read.statement.sql).toContain(
        "SELECT TenantId, AggregateId, EventId, EventTimestamp, EventOccurredAt, EventType, EventPayload, EventVersion, ProcessingTraceparent, IdempotencyKey FROM event_log WHERE TenantId IN ({tenantIds:Array(String)})",
      );
      expect(read.statement.sql).toContain("AggregateId IN ({v1:Array(String)})");
      expect(read.statement.sql).toMatch(
        /ORDER BY TenantId ASC, AggregateId ASC, EventTimestamp ASC, EventId ASC$/,
      );
      expect(read.statement.params).toMatchObject({
        tenantIds: ["project_a", "project_c"],
        v1: ["agg-1", "agg-2"],
      });
      expect(read.declaresFullScan).toBe(true);
    });

    it("prunes by a positive lower bound and declares no full scan", () => {
      const read = eventsOfAggregatesRead({
        tenantIds: ["project_a"],
        aggregateType: "trace",
        aggregateIds: ["agg-1"],
        occurredAtFromMs: 5_000,
      });

      expect(read.declaresFullScan).toBeUndefined();
      expect(read.statement.sql).toContain("OR EventOccurredAt >= {v3:UInt64}");
    });
  });

  describe("when an aggregate's events up to an event are read", () => {
    it("bounds acceptance order by the event, inclusive of it", () => {
      const read = aggregateEventsUpToRead({
        ...KEY,
        upToTimestamp: 9_000,
        upToEventId: "evt-9",
        occurredAtFromMs: undefined,
      });

      expectSingleTenant(read.statement);
      expect(read.declaresFullScan).toBe(true);
      expect(read.statement.sql).toMatch(
        /\(EventTimestamp < \{v2:UInt64\} OR \(EventTimestamp = \{v3:UInt64\} AND EventId <= \{v4:String\}\)\) ORDER BY EventTimestamp ASC, EventId ASC$/,
      );
      expect(read.statement.params).toMatchObject({ v2: 9_000, v3: 9_000, v4: "evt-9" });
    });

    it("pages strictly after a cursor, capped at the page size", () => {
      const read = aggregateEventsUpToRead({
        ...KEY,
        upToTimestamp: 9_000,
        upToEventId: "evt-9",
        occurredAtFromMs: 5_000,
        page: { after: { timestamp: 7_000, eventId: "evt-7" }, limit: 500 },
      });

      expectSingleTenant(read.statement);
      expect(read.declaresFullScan).toBeUndefined();
      expect(read.statement.sql).toMatch(
        /\(EventTimestamp > \{v7:UInt64\} OR \(EventTimestamp = \{v8:UInt64\} AND EventId > \{v9:String\}\)\) ORDER BY EventTimestamp ASC, EventId ASC LIMIT 500$/,
      );
      expect(read.statement.params).toMatchObject({ v7: 7_000, v8: 7_000, v9: "evt-7" });
    });

    it("reads the first page with no cursor", () => {
      const read = aggregateEventsUpToRead({
        ...KEY,
        upToTimestamp: 9_000,
        upToEventId: "evt-9",
        occurredAtFromMs: undefined,
        page: { after: undefined, limit: 100 },
      });

      expect(read.statement.sql).not.toContain("EventTimestamp >");
      expect(read.statement.sql).toMatch(/LIMIT 100$/);
    });
  });

  describe("when the events before an event are counted", () => {
    it("counts distinct events strictly before it, the event itself excluded", () => {
      const { statement, ...rest } = eventCountBeforeRead({
        ...KEY,
        beforeTimestamp: 9_000,
        beforeEventId: "evt-9",
        occurredAtFromMs: undefined,
      });

      expectSingleTenant(statement);
      expect(rest).toEqual({});
      expect(statement.sql).toMatch(/^SELECT countDistinct\(EventId\) AS count FROM event_log/);
      expect(statement.sql).toContain(
        "((EventTimestamp < {v2:UInt64} OR (EventTimestamp = {v3:UInt64} AND EventId < {v4:String})) AND EventId != {v5:String})",
      );
    });

    it("keeps a zero lower bound, as the index's earliest time may be", () => {
      const { statement } = eventCountBeforeRead({
        ...KEY,
        beforeTimestamp: 9_000,
        beforeEventId: "evt-9",
        occurredAtFromMs: 0,
      });

      expect(statement.sql).toContain(
        "(EventOccurredAt = {v2:UInt64} OR EventOccurredAt >= {v3:UInt64})",
      );
    });
  });
});
