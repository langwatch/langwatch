import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * Trace's evaluation rows beside their trace's columns (goose 00129, trace ADR-003). A
 * VersionedCollapsingMergeTree, so no version column: readers sum `Sign` instead.
 */
export const traceEvaluationAnalytics = defineClickHouseTable({
  name: "trace_evaluation_analytics",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  sortKey: ["TenantId", "OccurredAt", "TraceId", "EvaluationId", "Revision"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    EvaluationId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    TraceOccurredAt: column.dateTime64({ precision: 3 }),
    EvaluatorName: column.nullable(column.string()),
    Status: column.lowCardinalityString(),
    IsGuardrail: column.bool(),
    Passed: column.nullable(column.bool()),
    Label: column.nullable(column.string()),
    Origin: column.nullable(column.string()),
    TraceOrigin: column.nullable(column.string()),
    CustomerId: column.nullable(column.string()),
    TopicId: column.nullable(column.string()),
    Labels: column.stringArray(),
    MetadataTopic: column.string(),
    MetadataDocumentType: column.string(),
    MetadataLanguage: column.string(),
    MetadataTeam: column.string(),
    MetadataFlow: column.string(),
    MetadataSegment: column.string(),
    MetadataPromptVersion: column.string(),
    Sign: column.int8(),
    Revision: column.uint64(),
    _retention_days: column.uint16(),
  },
});
