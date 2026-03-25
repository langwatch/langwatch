/**
 * ClickHouse test data seeding utilities for memory-safety integration tests.
 *
 * Inserts realistic trace and span data into test ClickHouse containers
 * with configurable attribute sizes for memory budget testing.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";

interface SeedSpansOptions {
  /** Tenant ID for data isolation */
  tenantId: string;
  /** Number of spans to insert */
  count: number;
  /** Number of keys per SpanAttributes Map */
  attributeKeys: number;
  /** Bytes per attribute value (default ~100 bytes) */
  attributeValueSize?: number;
  /** Distribute spans across N traces */
  traceCount: number;
  /** If set, each trace gets this TotalCost for result verification */
  knownCost?: number;
}

/**
 * Generate a Map of string attributes with the specified number of keys and value sizes.
 */
function generateAttributes(
  keyCount: number,
  valueSize: number,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  const padding = "x".repeat(Math.max(0, valueSize - 10));
  for (let i = 0; i < keyCount; i++) {
    attrs[`attr_key_${i}`] = `val_${i}_${padding}`;
  }
  return attrs;
}

/**
 * Seed spans and trace summaries into ClickHouse for integration testing.
 *
 * Inserts rows into both `trace_summaries` and `stored_spans` tables with
 * configurable attribute widths. Uses synchronous inserts (async_insert: 0)
 * for deterministic test behavior.
 *
 * @param ch - ClickHouse client connected to the test database
 * @param opts - Seeding configuration
 */
export async function seedSpans(
  ch: ClickHouseClient,
  opts: SeedSpansOptions,
): Promise<void> {
  const {
    tenantId,
    count,
    attributeKeys,
    attributeValueSize = 100,
    traceCount,
    knownCost,
  } = opts;

  const now = Date.now();
  const spansPerTrace = Math.ceil(count / traceCount);

  // Pre-generate trace IDs for deterministic distribution
  const traceIds: string[] = [];
  for (let t = 0; t < traceCount; t++) {
    traceIds.push(`${tenantId}-trace-${t}`);
  }

  // Build trace summary rows
  const traceSummaryRows = traceIds.map((traceId, t) => ({
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {
      "langwatch.user_id": `user-${t % 10}`,
      "gen_ai.conversation.id": `thread-${t % 50}`,
      "metadata.env": "test",
    },
    OccurredAt: new Date(now - t * 1000),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    ComputedIOSchemaVersion: "",
    ComputedInput: "test input",
    ComputedOutput: "test output",
    TimeToFirstTokenMs: 50,
    TimeToLastTokenMs: 200,
    TotalDurationMs: 200,
    TokensPerSecond: 100,
    SpanCount: spansPerTrace,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    ErrorMessage: null,
    Models: ["gpt-5-mini"],
    TotalCost: knownCost ?? 0.01,
    TokensEstimated: false,
    TotalPromptTokenCount: 100,
    TotalCompletionTokenCount: 50,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: `topic-${t % 5}`,
    SubTopicId: `subtopic-${t % 10}`,
    HasAnnotation: null,
  }));

  // Insert trace summaries in batches to avoid oversized payloads
  const BATCH_SIZE = 1000;
  for (let i = 0; i < traceSummaryRows.length; i += BATCH_SIZE) {
    const batch = traceSummaryRows.slice(i, i + BATCH_SIZE);
    await ch.insert({
      table: "trace_summaries",
      values: batch,
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }

  // Build span rows with configurable attribute widths
  const spanAttributes = generateAttributes(attributeKeys, attributeValueSize);
  // Add the span type key that analytics queries look for
  spanAttributes["langwatch.span.type"] = "llm";

  const spanRows: Array<Record<string, unknown>> = [];
  let spanIndex = 0;

  for (let t = 0; t < traceCount; t++) {
    const traceId = traceIds[t]!;
    const spansForThisTrace = Math.min(
      spansPerTrace,
      count - t * spansPerTrace,
    );
    if (spansForThisTrace <= 0) break;

    for (let s = 0; s < spansForThisTrace; s++) {
      spanRows.push({
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        SpanId: `span-${spanIndex}`,
        ParentSpanId: null,
        ParentTraceId: null,
        ParentIsRemote: null,
        Sampled: 1,
        StartTime: new Date(now - t * 1000),
        EndTime: new Date(now - t * 1000 + 200),
        DurationMs: 200,
        SpanName: "test-span",
        SpanKind: 1,
        ServiceName: "test-service",
        ResourceAttributes: {},
        SpanAttributes: spanAttributes,
        StatusCode: 1,
        StatusMessage: "",
        ScopeName: "",
        ScopeVersion: null,
        "Events.Timestamp": [],
        "Events.Name": [],
        "Events.Attributes": [],
        "Links.TraceId": [],
        "Links.SpanId": [],
        "Links.Attributes": [],
        DroppedAttributesCount: 0,
        DroppedEventsCount: 0,
        DroppedLinksCount: 0,
      });
      spanIndex++;
    }
  }

  // Insert spans in batches
  for (let i = 0; i < spanRows.length; i += BATCH_SIZE) {
    const batch = spanRows.slice(i, i + BATCH_SIZE);
    await ch.insert({
      table: "stored_spans",
      values: batch,
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
}
