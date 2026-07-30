import { ch } from "../schema/columns";
import { defineTable, replacing, type TableRow } from "../schema/defineTable";

/**
 * `event_log` — the event-sourcing append log, transcribed from the deployed
 * `CREATE TABLE` (`langwatch/src/server/clickhouse/migrations/00002_create_schema.sql:15-38`).
 * That migration is immutable, so every fact below — column name, type,
 * declaration order, sort key, partition expression, version column — is
 * copied from it verbatim, not invented or "improved". It carries no
 * `TTL` clause; retention is applied out-of-band by `ttlReconciler.ts`, so
 * this declaration has no `ttl`.
 *
 * `EventTimestamp` and `EventOccurredAt` are the deployed table's `UInt64`
 * epoch-millisecond version and partition columns — the reason
 * `ch.*EpochMillis()` exists (see `columns.ts`).
 */
export const eventLogTable = defineTable({
  name: "event_log",
  merge: replacing({ version: "EventTimestamp" }),
  sortKey: ["TenantId", "AggregateType", "AggregateId", "IdempotencyKey"],
  partition: {
    by: "toYearWeek(toDateTime64(EventOccurredAt / 1000, 3))",
    column: "EventOccurredAt",
  },
  tenant: ["TenantId"],
  // ADR-099 "Known debt this does not fix yet" — the recorded fix is a re-key onto CreatedAt.
  structuralDebt: [
    {
      column: "EventOccurredAt",
      reason:
        "EventOccurredAt is customer-supplied event time, not platform accept time, and anchors the partition on the highest-volume table in the system",
    },
  ],
  columns: {
    TenantId: ch.string(),
    IdempotencyKey: ch.string(),
    AggregateType: ch.lowCardinality(ch.string()),
    AggregateId: ch.string(),
    EventId: ch.string(),
    EventType: ch.lowCardinality(ch.string()),
    EventVersion: ch.lowCardinality(ch.string()),
    EventTimestamp: ch.writtenAtEpochMillis(),
    CreatedAt: ch.dateTime64(3),
    EventPayload: ch.string(),
    ProcessingTraceparent: ch.string(),
    // True role: customer-supplied, not platform-controlled (see structuralDebt above).
    EventOccurredAt: ch.occurredAtEpochMillis(),
  },
});

export type EventLogRow = TableRow<(typeof eventLogTable)["columns"]>;
