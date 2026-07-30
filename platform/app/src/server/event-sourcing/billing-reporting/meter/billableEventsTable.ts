import { ch, defineTable, replacing } from "@langwatch/clickhouse";

/**
 * `billable_events` — the deduplicated record of every billable event, one
 * row per event, keyed so a redelivery collapses rather than double-billing
 * (ADR-099; migration `00002_create_schema.sql`, section 8, "Usage metering
 * records").
 *
 * This is the mechanism that keeps double-billing impossible: the table's
 * merge strategy is `ReplacingMergeTree(UpdatedAt)`, and its `ORDER BY`
 * leads with `(OrganizationId, TenantId, DeduplicationKeyHash)`. Two writes
 * for the same dedup key — a retried job, a replayed event, an at-least-once
 * redelivery — land on the *same* sort key, so ClickHouse collapses them to
 * one row instead of two, and `EventTimestamp` never enters the identity. The
 * read side (`@ee/billing/services/billableEventsQuery.ts`, outside this
 * pipeline's directory and unchanged by this rewrite) does not even wait for
 * that merge to happen: it counts `countDistinct(DeduplicationKeyHash)`
 * rather than `count(*)`, so an unmerged duplicate still contributes exactly
 * one to the total.
 *
 * KNOWN GAP — flagged, not silently worked around: the real table's sort key
 * is not `DeduplicationKey` but `DeduplicationKeyHash UInt64 MATERIALIZED
 * cityHash64(DeduplicationKey)`. `defineTable` (ADR-099, `@langwatch/clickhouse`)
 * has no representation for a MATERIALIZED column — every column it declares
 * is assumed insertable, because `createAppendStore` writes a value for every
 * declared column, and ClickHouse rejects an explicit INSERT column list that
 * names a MATERIALIZED one ("Cannot insert into a materialized column"). So
 * this declaration:
 *
 *   - omits `DeduplicationKeyHash` entirely (the write path never mentions
 *     it; ClickHouse computes it server-side from `DeduplicationKey`, exactly
 *     as the pre-rewrite insert already did), and
 *   - names `DeduplicationKey` — the hash's pre-image, not the hash itself —
 *     as the last `sortKey` segment, so `defineTable`'s "sort key names a
 *     declared column" check has something true to check.
 *
 * The dedup *identity* is unaffected (the hash is a pure function of the key
 * this declaration does write), but this is not a byte-accurate transcription
 * of the migration's `ORDER BY` clause, and no drift test can catch that today
 * — `@langwatch/clickhouse` does not yet check a `defineTable` declaration
 * against migration DDL (ADR-099 names that as future work, "extending the
 * existing drift test"). Also omitted: `CreatedAt DateTime64(3) DEFAULT
 * now64(3)`, which nothing downstream of this pipeline reads and which
 * ClickHouse fills in on its own default when a column is left out of an
 * explicit INSERT column list — same behaviour the pre-rewrite insert relied
 * on by never mentioning it either.
 */
export const billableEventsTable = defineTable({
  name: "billable_events",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["OrganizationId", "TenantId", "DeduplicationKey"],
  partition: { by: "toYYYYMM(EventTimestamp)", column: "EventTimestamp" },
  tenant: ["TenantId", "OrganizationId"],
  columns: {
    OrganizationId: ch.string(),
    TenantId: ch.string(),
    EventId: ch.string(),
    EventType: ch.lowCardinality(ch.string()),
    DeduplicationKey: ch.string(),
    // The event's own accept-time stamp (`event.createdAt` in the pre-rewrite
    // core: "When this event was created/written", stamped by our ingest
    // boundary). Frozen once the `event_log` row is written and never
    // customer-set, which is exactly the `acceptedAt` role (ADR-099) —
    // the only role `defineTable` accepts for a partition column.
    EventTimestamp: ch.acceptedAt(),
    // The `ReplacingMergeTree` version column. Stamped by the store on every
    // write (`writtenAt` role), never read back — this store never reads a
    // row, so unlike a fold's replace store there is no "preserve across
    // writes" concern here.
    UpdatedAt: ch.writtenAt(),
  },
});
