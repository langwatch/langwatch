import { ch, defineTable, replacing } from "@langwatch/clickhouse";

/**
 * `billable_events` — one row per billable event, keyed so a redelivery
 * collapses rather than double-billing (migration `00002_create_schema.sql` §8).
 * Two writes for the same dedup key land on the same sort key; the read side
 * counts `countDistinct(DeduplicationKeyHash)`, so even an unmerged duplicate
 * contributes exactly one.
 *
 * The real table sorts on `DeduplicationKeyHash MATERIALIZED
 * cityHash64(DeduplicationKey)`, which `defineTable` cannot represent, so its
 * pre-image stands in the sort key here — same dedup identity, not a
 * byte-accurate transcription of the migration's ORDER BY.
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
    /** The event's accept-time stamp, frozen when the `event_log` row is
     *  written and never customer-set — the only role `defineTable` accepts
     *  for a partition column. */
    EventTimestamp: ch.acceptedAt(),
    /** The `ReplacingMergeTree` version column, stamped on every write. This
     *  store never reads a row back, so nothing is preserved across writes. */
    UpdatedAt: ch.writtenAt(),
  },
});
