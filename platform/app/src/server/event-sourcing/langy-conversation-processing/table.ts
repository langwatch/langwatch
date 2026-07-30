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
 * `langy_analytics_events` (migration 00047), declared in the shape a store may
 * use rather than the shape deployed today: the deployed DDL partitions and
 * expires on `OccurredAt`, which the customer's process stamps, so neither role
 * may anchor on it (ADR-099). Both move onto `AcceptedAt`; one re-key migration
 * makes the deployed table match. `_size_bytes` stays undeclared — it is
 * MATERIALIZED, never inserted.
 */
export const langyAnalyticsEventsTable = defineTable({
  name: "langy_analytics_events",
  merge: replacing({ version: "ProjectedAt" }),
  sortKey: ["TenantId", "AcceptedAt", "EventId"],
  partition: { by: "toYearWeek(toDate(AcceptedAt))", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
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
