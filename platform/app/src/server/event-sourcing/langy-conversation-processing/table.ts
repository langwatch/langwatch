import {
  ch,
  defineTable,
  deriveAppendMapping,
  replacing,
} from "@langwatch/clickhouse";
import {
  type LangyAnalyticsEventRecord,
  langyAnalyticsEventRecordSchema,
} from "./maps";

/**
 * `langy_analytics_events` as migration 00047 deployed it. `_size_bytes` stays
 * undeclared — it is MATERIALIZED, never inserted.
 */
export const langyAnalyticsEventsTable = defineTable({
  name: "langy_analytics_events",
  merge: replacing({ version: "ProjectedAt" }),
  sortKey: ["TenantId", "OccurredAt", "EventId"],
  partition: { by: "toYearWeek(toDate(OccurredAt))", column: "OccurredAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "OccurredAt" },
  structuralDebt: [
    {
      column: "OccurredAt",
      reason:
        "migration 00047 partitions, expires and time-leads langy_analytics_events on OccurredAt — the domain event's own time, not the platform-set acceptedAt role. AcceptedAt is already on the row, so the re-key is a new table and a copy with no backfill of missing data, but neither ORDER BY nor PARTITION BY is alterable in place",
    },
  ],
  columns: {
    TenantId: ch.string(),
    EventId: ch.string(),
    EventType: ch.lowCardinality(ch.string()),
    EventVersion: ch.lowCardinality(ch.string()),
    AggregateId: ch.string(),
    TurnId: ch.nullable(ch.string()),
    UserId: ch.nullable(ch.string()),
    Role: ch.lowCardinality(ch.nullable(ch.string())),
    ToolName: ch.lowCardinality(ch.nullable(ch.string())),
    Outcome: ch.lowCardinality(ch.nullable(ch.string())),
    Model: ch.lowCardinality(ch.nullable(ch.string())),
    DurationMs: ch.nullable(ch.uint64()),
    OccurredAt: ch.occurredAt(),
    AcceptedAt: ch.acceptedAt(),
    ProjectedAt: ch.writtenAt(),
    _retention_days: ch.uint16(),
  },
});

export type LangyAnalyticsEventColumns =
  typeof langyAnalyticsEventsTable.columns;

/** Mirrors the deployed migration's `_retention_days` default. */
export const LANGY_ANALYTICS_RETENTION_DAYS = 308;

export const langyAnalyticsEventRow = deriveAppendMapping<
  LangyAnalyticsEventRecord,
  LangyAnalyticsEventColumns
>({
  table: langyAnalyticsEventsTable,
  record: langyAnalyticsEventRecordSchema,
  fill: {
    TenantId: (_record, context) => context.tenantId,
    ProjectedAt: () => new Date(),
    _retention_days: (_record, context) =>
      context.retentionDays ?? LANGY_ANALYTICS_RETENTION_DAYS,
  },
});
