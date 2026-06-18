/**
 * Shared raw ClickHouse row builders for #4888 full-flag read-path tests.
 *
 * Parameterized by `TenantId` (span row) and preview value so the same shape
 * can serve both the TraceService-level unit tests (tenant-aaa/tenant-bbb) and
 * the CH-layer mapper-crossing tests (proj-4888).
 *
 * NOTE: `clickhouse-trace.service-resolution.unit.test.ts` uses its own simpler
 * fixtures (no `ts_NonBilledCost`, different `ts_ComputedOutput` format) — its
 * structural divergence exceeds what parameterization cleanly handles, so that
 * file keeps its own copies (per Metz-Beck: duplication over wrong abstraction).
 */

import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";

/**
 * Options for {@link makeSummaryRow}.
 */
export interface SummaryRowOpts {
  /** Override the serialized ts_ComputedOutput JSON string. */
  computedOutput?: string;
}

/**
 * Minimal trace-summary row as returned by ClickHouse.
 *
 * @param traceId - The trace ID to embed.
 * @param opts - Optional overrides.
 */
export function makeSummaryRow(traceId: string, opts?: SummaryRowOpts) {
  const defaultOutput = '{"type":"text","value":"preview…"}';
  return {
    ts_TraceId: traceId,
    ts_SpanCount: 1,
    ts_TotalDurationMs: 100,
    ts_ComputedIOSchemaVersion: "1",
    ts_ComputedInput: null,
    ts_ComputedOutput: opts?.computedOutput ?? defaultOutput,
    ts_TimeToFirstTokenMs: 10,
    ts_TimeToLastTokenMs: 90,
    ts_TokensPerSecond: 5,
    ts_ContainsErrorStatus: false,
    ts_ContainsOKStatus: true,
    ts_ErrorMessage: "",
    ts_Models: [],
    ts_TotalCost: 0.0,
    ts_NonBilledCost: 0.0,
    ts_TokensEstimated: false,
    ts_TotalPromptTokenCount: 0,
    ts_TotalCompletionTokenCount: 0,
    ts_TopicId: null,
    ts_SubTopicId: null,
    ts_HasAnnotation: null,
    ts_AnnotationIds: [],
    ts_Attributes: {},
    ts_TraceName: null,
    ts_OccurredAt: Date.now(),
    ts_CreatedAt: Date.now(),
    ts_UpdatedAt: Date.now(),
  };
}

/**
 * Options for {@link makeSpanRowWithEventRef}.
 */
export interface SpanRowOpts {
  /** The TenantId to embed in the span row. */
  tenantId: string;
  /** The preview value to embed in SpanAttributes["langwatch.output"]. */
  previewOutput: string;
}

/**
 * Minimal span row carrying an offloaded eventref for langwatch.output.
 *
 * Produces the real production shape: a flat `SpanAttributes` map with:
 * - `"langwatch.output"` set to the preview value
 * - `"${EVENTREF_ATTR_PREFIX}langwatch.output"` set to a JSON eventref pointer
 *
 * @param traceId - The trace ID to embed.
 * @param spanId - The span ID to embed.
 * @param opts - TenantId and preview value options.
 */
export function makeSpanRowWithEventRef(
  traceId: string,
  spanId: string,
  opts: SpanRowOpts,
) {
  return {
    SpanId: spanId,
    TraceId: traceId,
    TenantId: opts.tenantId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: true,
    StartTime: Date.now(),
    EndTime: Date.now() + 100,
    DurationMs: 100,
    SpanName: "llm-call",
    SpanKind: 1,
    ResourceAttributes: {},
    SpanAttributes: {
      "langwatch.output": opts.previewOutput,
      [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
        field: "langwatch.output",
        eventId: "evt-001",
      }),
    },
    StatusCode: 1,
    StatusMessage: "",
    ScopeName: "test",
    ScopeVersion: "1.0",
    Events_Timestamp: [],
    Events_Name: [],
    Events_Attributes: [],
    Links_TraceId: [],
    Links_SpanId: [],
    Links_Attributes: [],
  };
}
