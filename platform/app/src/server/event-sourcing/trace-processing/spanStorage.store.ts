import { createAppendStore, type ClickHouseClient } from "@langwatch/clickhouse";
import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import { storedSpansTable } from "./spanStorage.table";
import type { CanonicalSpan } from "./schema";
import type { StoredSpansRow } from "./spanStorage.table";

const DEFAULT_RETENTION_DAYS = 308;

function toRow(span: CanonicalSpan, context: BatchContext): StoredSpansRow {
  const writtenAt = new Date();
  return {
    ParentSpanId: span.parentSpanId,
    Name: span.name,
    Kind: span.kind,
    StatusCode: span.statusCode,
    StatusMessage: span.statusMessage,
    InstrumentationScopeName: span.instrumentationScopeName,
    Model: span.model,
    Cost: span.cost.cost,
    PiiRedactionStatus: span.piiRedactionStatus,
    TenantId: span.tenantId,
    TraceId: span.traceId,
    SpanId: span.spanId,
    StartTimeUnixMs: BigInt(Math.max(0, span.startTimeUnixMs)),
    EndTimeUnixMs: BigInt(Math.max(0, span.endTimeUnixMs)),
    DurationMs: BigInt(Math.max(0, span.endTimeUnixMs - span.startTimeUnixMs)),
    AttributesJson: JSON.stringify(span.attributes),
    ResourceAttributesJson: JSON.stringify(span.resourceAttributes),
    NonBilledCost: span.cost.nonBilledCost,
    PromptTokens: span.usage.inputTokens === null ? null : BigInt(Math.max(0, span.usage.inputTokens)),
    CompletionTokens: span.usage.outputTokens === null ? null : BigInt(Math.max(0, span.usage.outputTokens)),
    OccurredAt: new Date(span.occurredAt),
    AcceptedAt: new Date(span.acceptedAt),
    WrittenAt: writtenAt,
    _retention_days: context.retentionDays ?? DEFAULT_RETENTION_DAYS,
  };
}

export function createSpanStorageStore(args: { readonly client: ClickHouseClient }): AppendStore<CanonicalSpan> {
  return createAppendStore<CanonicalSpan, typeof storedSpansTable.columns>({
    client: args.client,
    table: storedSpansTable,
    toRow,
  });
}
