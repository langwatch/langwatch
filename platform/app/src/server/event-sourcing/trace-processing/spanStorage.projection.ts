import { deriveAppendMapping } from "@langwatch/clickhouse";
import { z } from "zod";
import type { CanonicalSpan } from "./schema";
import { spanType as spanTypeOf } from "./spanDerivation";
import { storedSpansTable } from "./table";

/** Mirrors the deployed migrations' `_retention_days` column default. */
export const DEFAULT_RETENTION_DAYS = 308;

/**
 * One `stored_spans` record per span, written by a map projection and never
 * read back into a fold (ADR-098 §2). Every trace-level total is a query over
 * these rows, so a field a total needs has to be a column here (ADR-103).
 * The store owns `TenantId`, `WrittenAt` and retention.
 */
export const storedSpanRecordSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  name: z.string(),
  kind: z.string(),
  spanType: z.string(),
  startTimeUnixMs: z.number(),
  endTimeUnixMs: z.number(),
  durationMs: z.number(),
  statusCode: z.string(),
  statusMessage: z.string().nullable(),
  instrumentationScopeName: z.string(),
  model: z.string(),
  cost: z.number().nullable(),
  nonBilledCost: z.number().nullable(),
  promptTokens: z.number().nullable(),
  completionTokens: z.number().nullable(),
  cacheReadTokens: z.number().nullable(),
  cacheWriteTokens: z.number().nullable(),
  reasoningTokens: z.number().nullable(),
  tokensEstimated: z.boolean(),
  attributesJson: z.string(),
  resourceAttributesJson: z.string(),
  piiRedactionStatus: z.string(),
  occurredAt: z.number(),
  acceptedAt: z.number(),
});
export type StoredSpanRecord = z.infer<typeof storedSpanRecordSchema>;

/** Stored regardless of how large the trace is — the no-drop half of the cap. */
export function mapSpanReceived(span: CanonicalSpan): StoredSpanRecord {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    kind: span.kind,
    spanType: spanTypeOf(span) ?? "",
    startTimeUnixMs: Math.max(0, span.startTimeUnixMs),
    endTimeUnixMs: Math.max(0, span.endTimeUnixMs),
    durationMs: Math.max(0, span.endTimeUnixMs - span.startTimeUnixMs),
    statusCode: span.statusCode,
    statusMessage: span.statusMessage,
    instrumentationScopeName: span.instrumentationScopeName,
    model: span.model ?? "",
    cost: span.cost.cost,
    nonBilledCost: span.cost.nonBilledCost,
    promptTokens: nonNegative(span.usage.inputTokens),
    completionTokens: nonNegative(span.usage.outputTokens),
    cacheReadTokens: nonNegative(span.usage.cacheReadTokens),
    cacheWriteTokens: nonNegative(span.usage.cacheWriteTokens),
    reasoningTokens: nonNegative(span.usage.reasoningTokens),
    tokensEstimated: span.usage.estimated,
    attributesJson: JSON.stringify(span.attributes),
    resourceAttributesJson: JSON.stringify(span.resourceAttributes),
    piiRedactionStatus: span.piiRedactionStatus ?? "",
    occurredAt: span.occurredAt,
    acceptedAt: span.acceptedAt,
  };
}

/** A reported zero stays zero; only an unreported count is null. */
function nonNegative(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.round(value));
}

/** `TenantId`, `WrittenAt` and retention are the store's own stamps, not the record's. */
export const toStoredSpanRow = deriveAppendMapping<
  StoredSpanRecord,
  typeof storedSpansTable.columns
>({
  table: storedSpansTable,
  record: storedSpanRecordSchema,
  fill: {
    TenantId: (_record, context) => context.tenantId,
    WrittenAt: () => new Date(),
    _retention_days: (_record, context) =>
      context.retentionDays ?? DEFAULT_RETENTION_DAYS,
  },
});
