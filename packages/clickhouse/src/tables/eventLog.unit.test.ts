import { describe, expect, it } from "vitest";
import { eventLogTable } from "./eventLog.js";

/**
 * `event_log`'s deployed DDL (migration `00002_create_schema.sql:15-38`) is
 * the reason the UInt64 time-role columns exist: its version and its
 * partition anchor are both `UInt64` epoch milliseconds, not `DateTime64`.
 * These tests pin the declaration to that DDL's facts and prove the two
 * structural uses `defineTable` gates — a `ReplacingMergeTree` version and a
 * partition anchor — both work when the underlying role is UInt64-backed.
 */

describe("given the event_log table declaration", () => {
  it("matches the deployed column order, names and ClickHouse types exactly", () => {
    const description = eventLogTable.describe();

    expect(description.columnNames).toEqual([
      "TenantId",
      "IdempotencyKey",
      "AggregateType",
      "AggregateId",
      "EventId",
      "EventType",
      "EventVersion",
      "EventTimestamp",
      "CreatedAt",
      "EventPayload",
      "ProcessingTraceparent",
      "EventOccurredAt",
    ]);

    expect(description.columnTypes).toEqual({
      TenantId: "String",
      IdempotencyKey: "String",
      AggregateType: "LowCardinality(String)",
      AggregateId: "String",
      EventId: "String",
      EventType: "LowCardinality(String)",
      EventVersion: "LowCardinality(String)",
      EventTimestamp: "UInt64",
      CreatedAt: "DateTime64(3)",
      EventPayload: "String",
      ProcessingTraceparent: "String",
      EventOccurredAt: "UInt64",
    });
  });

  it("matches the deployed sort key", () => {
    expect(eventLogTable.sortKey).toEqual([
      "TenantId",
      "AggregateType",
      "AggregateId",
      "IdempotencyKey",
    ]);
  });

  it("matches the deployed tenant scope", () => {
    expect(eventLogTable.tenant).toEqual(["TenantId"]);
  });

  it("declares no TTL, matching the migration's CREATE TABLE having none", () => {
    expect(eventLogTable.describe().ttl).toBeUndefined();
  });

  describe("the ReplacingMergeTree version", () => {
    /** @scenario the event_log table anchors its ReplacingMergeTree version on a UInt64-backed writtenAt column */
    it("is EventTimestamp, a UInt64-backed writtenAt column, matching ENGINE = ReplacingMergeTree(EventTimestamp)", () => {
      expect(eventLogTable.merge).toEqual({
        kind: "replacing",
        version: "EventTimestamp",
      });
      expect(eventLogTable.columns.EventTimestamp.chType).toBe("UInt64");
      expect(eventLogTable.columns.EventTimestamp.timeRole).toBe("writtenAt");
    });
  });

  describe("the partition anchor", () => {
    /** @scenario the event_log table anchors its partition on a UInt64-backed role column */
    it("is EventOccurredAt, a UInt64-backed column, matching PARTITION BY toYearWeek(toDateTime64(EventOccurredAt / 1000, 3))", () => {
      expect(eventLogTable.partition).toEqual({
        by: "toYearWeek(toDateTime64(EventOccurredAt / 1000, 3))",
        column: "EventOccurredAt",
      });
      expect(eventLogTable.columns.EventOccurredAt.chType).toBe("UInt64");
    });

    /** @scenario event_log declares its partition column's true occurredAt role and carries it as registered structural debt */
    it("declares EventOccurredAt's true role — customer-supplied, not frozen or platform-controlled — exempted as structural debt", () => {
      expect(eventLogTable.columns.EventOccurredAt.timeRole).toBe("occurredAt");
      expect(eventLogTable.columns.EventOccurredAt.frozen).toBe(false);
      expect(eventLogTable.columns.EventOccurredAt.platformControlled).toBe(
        false,
      );
      expect(eventLogTable.structuralDebt).toEqual([
        {
          column: "EventOccurredAt",
          reason: expect.any(String),
        },
      ]);
    });
  });

  describe("given a raw wire row", () => {
    /** @scenario a full event_log row round-trips through the declared codec with its UInt64 columns intact */
    it("decodes EventTimestamp and EventOccurredAt from their UInt64 wire strings", () => {
      const row = eventLogTable.rowSchema.parse({
        TenantId: "tenant-1",
        IdempotencyKey: "idem-1",
        AggregateType: "trace-processing",
        AggregateId: "trace-1",
        EventId: "event-1",
        EventType: "SpanRecorded",
        EventVersion: "v1",
        EventTimestamp: "1705314600123",
        CreatedAt: "2024-01-15 10:30:00.123",
        EventPayload: "{}",
        ProcessingTraceparent: "",
        EventOccurredAt: "1705314600000",
      });

      expect(row.EventTimestamp).toEqual(
        new Date(Date.UTC(2024, 0, 15, 10, 30, 0, 123)),
      );
      expect(row.EventOccurredAt).toEqual(
        new Date(Date.UTC(2024, 0, 15, 10, 30, 0, 0)),
      );
    });

    /** @scenario event_log's EventOccurredAt still encodes to the same UInt64 epoch millisecond wire value */
    it("still encodes EventOccurredAt to the same UInt64 epoch-millisecond wire string as the acceptedAt-labelled declaration did", () => {
      const instant = new Date(Date.UTC(2024, 0, 15, 10, 30, 0, 0));

      expect(eventLogTable.columns.EventOccurredAt.encode(instant)).toBe(
        "1705314600000",
      );
    });
  });
});
