/**
 * Fixtures + row builders for the per-model attribution integration tests
 * (model-group-attribution.integration.test.ts).
 *
 * The fixtures mirror the fold's invariants: every trace_summaries total is
 * the exact sum of the trace's span-level contributions (same SpanCostService
 * semantics, including the skip_token_accumulation gate), so partition
 * assertions test the SQL attribution, not fixture arithmetic. All costs are
 * exact at 6 decimal places so per-span rounding is a no-op.
 *
 * Timestamps are now-relative like every other ClickHouse integration
 * fixture in this repo: a fixed months-old date made the rows invisible to
 * the same queries on CI's ClickHouse stack (25.10.x + the local_primary
 * storage policy) while passing against a local 25.8 server.
 */

import type { ClickHouseClient } from "@clickhouse/client";

/** Fixture instant: one hour ago. */
export const T0 = Date.now() - 60 * 60 * 1000;

export const MODEL_OPUS = "claude-opus-5";
export const MODEL_SONNET = "claude-sonnet-4-5";
/** The [1m] context-window suffix survives ingestion and must stay its own bucket. */
export const MODEL_OPUS_1M = "claude-opus-5[1m]";
export const MODEL_HAIKU = "claude-haiku-4-5";

export interface SpanFixture {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  model?: string;
  cost?: number;
  nonBilledCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  skipTokenAccumulation?: boolean;
  /** Shift this span's StartTime relative to T0 (e.g. outside the scan envelope). */
  startTimeOffsetMs?: number;
}

export interface TraceFixture {
  traceId: string;
  models: string[];
  totalCost: number | null;
  nonBilledCost?: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  labels?: string[];
  /** Legacy all-or-nothing bundled marker (pre-NonBilledCost history). */
  legacyNonBillableMarker?: boolean;
}

/**
 * Trace A: one multi-model trace (agent root + three LLM spans on distinct
 * models with distinct costs, one of them [1m]-suffixed).
 */
export const TRACE_MULTI: TraceFixture = {
  traceId: "trace-multi",
  models: [MODEL_OPUS_1M, MODEL_SONNET, MODEL_OPUS],
  totalCost: 0.875,
  nonBilledCost: 0.125,
  promptTokens: 7000,
  completionTokens: 700,
  cacheReadTokens: 10000,
  cacheWriteTokens: 500,
  reasoningTokens: 50,
  labels: ["session-x"],
};

export const TRACE_MULTI_SPANS: SpanFixture[] = [
  { traceId: "trace-multi", spanId: "a-root", parentSpanId: null },
  {
    traceId: "trace-multi",
    spanId: "a-opus",
    parentSpanId: "a-root",
    model: MODEL_OPUS,
    cost: 0.5,
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 10000,
    cacheWriteTokens: 500,
    reasoningTokens: 50,
  },
  {
    traceId: "trace-multi",
    spanId: "a-sonnet",
    parentSpanId: "a-root",
    model: MODEL_SONNET,
    cost: 0.25,
    inputTokens: 2000,
    outputTokens: 200,
  },
  {
    traceId: "trace-multi",
    spanId: "a-opus1m",
    parentSpanId: "a-root",
    model: MODEL_OPUS_1M,
    cost: 0.125,
    nonBilledCost: 0.125,
    inputTokens: 4000,
    outputTokens: 400,
  },
];

/** Trace B: single-model trace. */
export const TRACE_SINGLE: TraceFixture = {
  traceId: "trace-single",
  models: [MODEL_HAIKU],
  totalCost: 0.0625,
  promptTokens: 800,
  completionTokens: 80,
};

export const TRACE_SINGLE_SPANS: SpanFixture[] = [
  { traceId: "trace-single", spanId: "b-root", parentSpanId: null },
  {
    traceId: "trace-single",
    spanId: "b-haiku",
    parentSpanId: "b-root",
    model: MODEL_HAIKU,
    cost: 0.0625,
    inputTokens: 800,
    outputTokens: 80,
  },
];

/** Trace C: genuinely model-less trace; must bucket as `unknown` honestly. */
export const TRACE_MODELLESS: TraceFixture = {
  traceId: "trace-modelless",
  models: [],
  totalCost: null,
  promptTokens: null,
  completionTokens: null,
};

export const TRACE_MODELLESS_SPANS: SpanFixture[] = [
  { traceId: "trace-modelless", spanId: "c-root", parentSpanId: null },
];

/**
 * Trace D: a span pair where the second span is a redundant usage copy
 * (skip_token_accumulation). The fold counts the usage once, so the grouped
 * query must apply the same gate or the bucket overshoots the trace total.
 */
export const TRACE_SKIP: TraceFixture = {
  traceId: "trace-skip",
  models: [MODEL_HAIKU],
  totalCost: 0.03125,
  promptTokens: 100,
  completionTokens: 10,
};

export const TRACE_SKIP_SPANS: SpanFixture[] = [
  { traceId: "trace-skip", spanId: "d-root", parentSpanId: null },
  {
    traceId: "trace-skip",
    spanId: "d-haiku",
    parentSpanId: "d-root",
    model: MODEL_HAIKU,
    cost: 0.03125,
    inputTokens: 100,
    outputTokens: 10,
  },
  {
    traceId: "trace-skip",
    spanId: "d-haiku-copy",
    parentSpanId: "d-root",
    model: MODEL_HAIKU,
    cost: 0.03125,
    inputTokens: 100,
    outputTokens: 10,
    skipTokenAccumulation: true,
  },
];

/**
 * Trace E: legacy bundled history. The fold-time NonBilledCost column is
 * NULL (folded before it existed) and the all-or-nothing
 * `langwatch.cost.non_billable` trace marker is set, so the WHOLE trace is
 * bundled and each bucket's non-billed share must equal the bucket's cost.
 */
export const TRACE_LEGACY_BUNDLED: TraceFixture = {
  traceId: "trace-legacy-bundled",
  models: [MODEL_SONNET],
  totalCost: 0.25,
  nonBilledCost: null,
  legacyNonBillableMarker: true,
  promptTokens: null,
  completionTokens: null,
};

export const TRACE_LEGACY_BUNDLED_SPANS: SpanFixture[] = [
  { traceId: "trace-legacy-bundled", spanId: "e-root", parentSpanId: null },
  {
    traceId: "trace-legacy-bundled",
    spanId: "e-sonnet",
    parentSpanId: "e-root",
    model: MODEL_SONNET,
    cost: 0.25,
  },
];

/** Mirrors the fold's MAX_PROCESSED_SPANS cap (traceSummary.foldProjection). */
export const FOLD_SPAN_CAP = 512;

export const MODEL_CAP_A = "cap-model-a";
export const MODEL_CAP_B = "cap-model-b";

/**
 * Trace F: past the fold's processing cap. The fold froze the totals after
 * the first FOLD_SPAN_CAP spans (512 x 0.001 on model A), while stored_spans
 * also holds span 513 (1.0 on model B). Span-level attribution would report
 * 1.512 across two buckets against a 0.512 ungrouped total, so the query must
 * fall back to whole-trace attribution under the primary model.
 */
export const TRACE_OVER_CAP: TraceFixture = {
  traceId: "trace-over-cap",
  models: [MODEL_CAP_A],
  totalCost: 0.512,
  promptTokens: null,
  completionTokens: null,
};

export const TRACE_OVER_CAP_SPANS: SpanFixture[] = [
  ...Array.from({ length: FOLD_SPAN_CAP }, (_, i) => ({
    traceId: "trace-over-cap",
    spanId: `f-${i}`,
    parentSpanId: null,
    model: MODEL_CAP_A,
    cost: 0.001,
  })),
  {
    traceId: "trace-over-cap",
    spanId: `f-${FOLD_SPAN_CAP}`,
    parentSpanId: null,
    model: MODEL_CAP_B,
    cost: 1.0,
  },
];

export const MODEL_ENV_A = "env-model-a";
export const MODEL_ENV_B = "env-model-b";

/** StartTime offset that puts a span outside the query's 2-day scan cushion. */
export const OUTSIDE_ENVELOPE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Trace G: one contributing span outside the span scan envelope. The fold saw
 * both spans (TotalCost 0.09375, SpanCount 2) but the scan only sees the
 * in-window span, so span-level attribution would ship a PARTIAL partition
 * (model A's 0.03125 only). The incomplete-scan detection must put the whole
 * trace under its primary model instead.
 */
export const TRACE_OUTSIDE_ENVELOPE: TraceFixture = {
  traceId: "trace-outside-envelope",
  models: [MODEL_ENV_B, MODEL_ENV_A],
  totalCost: 0.09375,
  promptTokens: null,
  completionTokens: null,
};

export const TRACE_OUTSIDE_ENVELOPE_SPANS: SpanFixture[] = [
  {
    traceId: "trace-outside-envelope",
    spanId: "g-in",
    parentSpanId: null,
    model: MODEL_ENV_A,
    cost: 0.03125,
  },
  {
    traceId: "trace-outside-envelope",
    spanId: "g-out",
    parentSpanId: null,
    model: MODEL_ENV_B,
    cost: 0.0625,
    startTimeOffsetMs: -OUTSIDE_ENVELOPE_MS,
  },
];

export const ALL_TRACES = [
  TRACE_MULTI,
  TRACE_SINGLE,
  TRACE_MODELLESS,
  TRACE_SKIP,
  TRACE_LEGACY_BUNDLED,
  TRACE_OVER_CAP,
  TRACE_OUTSIDE_ENVELOPE,
];
export const ALL_SPANS = [
  ...TRACE_MULTI_SPANS,
  ...TRACE_SINGLE_SPANS,
  ...TRACE_MODELLESS_SPANS,
  ...TRACE_SKIP_SPANS,
  ...TRACE_LEGACY_BUNDLED_SPANS,
  ...TRACE_OVER_CAP_SPANS,
  ...TRACE_OUTSIDE_ENVELOPE_SPANS,
];

/** Ungrouped truths the grouped buckets must partition to. */
export const EXPECTED_TOTAL_COST =
  0.875 + 0.0625 + 0.03125 + 0.25 + 0.512 + 0.09375; // 1.8245
export const EXPECTED_NON_BILLED_COST = 0.125 + 0.25; // A's span split + E's legacy marker
export const EXPECTED_PROMPT_TOKENS = 7000 + 800 + 100; // 7900
export const EXPECTED_COMPLETION_TOKENS = 700 + 80 + 10; // 790
export const EXPECTED_TOTAL_TOKENS =
  EXPECTED_PROMPT_TOKENS + EXPECTED_COMPLETION_TOKENS; // 8690

export function traceSummaryRow(tenantId: string, t: TraceFixture) {
  const attributes: Record<string, string> = { "metadata.env": "test" };
  if (t.cacheReadTokens) {
    attributes["langwatch.reserved.cache_read_tokens"] = String(
      t.cacheReadTokens,
    );
  }
  if (t.cacheWriteTokens) {
    attributes["langwatch.reserved.cache_creation_tokens"] = String(
      t.cacheWriteTokens,
    );
  }
  if (t.reasoningTokens) {
    attributes["langwatch.reserved.reasoning_tokens"] = String(
      t.reasoningTokens,
    );
  }
  if (t.labels) {
    attributes["langwatch.labels"] = JSON.stringify(t.labels);
  }
  if (t.legacyNonBillableMarker) {
    attributes["langwatch.cost.non_billable"] = "true";
  }
  return {
    ProjectionId: `proj-${t.traceId}`,
    TenantId: tenantId,
    TraceId: t.traceId,
    Version: "v1",
    Attributes: attributes,
    OccurredAt: new Date(T0),
    CreatedAt: new Date(T0),
    UpdatedAt: new Date(T0),
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TimeToFirstTokenMs: 50,
    TimeToLastTokenMs: 200,
    TotalDurationMs: 200,
    TokensPerSecond: 100,
    SpanCount: ALL_SPANS.filter((s) => s.traceId === t.traceId).length,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    ErrorMessage: null,
    Models: t.models,
    TotalCost: t.totalCost,
    NonBilledCost: t.nonBilledCost ?? null,
    TokensEstimated: false,
    TotalPromptTokenCount: t.promptTokens,
    TotalCompletionTokenCount: t.completionTokens,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

const USAGE_ATTRIBUTE_BY_FIELD = {
  inputTokens: "gen_ai.usage.input_tokens",
  outputTokens: "gen_ai.usage.output_tokens",
  cacheReadTokens: "gen_ai.usage.cache_read.input_tokens",
  cacheWriteTokens: "gen_ai.usage.cache_creation.input_tokens",
  reasoningTokens: "gen_ai.usage.reasoning_tokens",
} as const;

function spanAttributes(s: SpanFixture): Record<string, string> {
  const attrs: Record<string, string> = s.model
    ? {
        "gen_ai.request.model": s.model,
        "gen_ai.response.model": s.model,
        "langwatch.span.type": "llm",
      }
    : { "langwatch.span.type": "agent" };

  for (const [field, attribute] of Object.entries(USAGE_ATTRIBUTE_BY_FIELD)) {
    const value = s[field as keyof typeof USAGE_ATTRIBUTE_BY_FIELD];
    if (value !== undefined) attrs[attribute] = String(value);
  }

  if (s.skipTokenAccumulation) {
    attrs["langwatch.reserved.skip_token_accumulation"] = "true";
  }
  return attrs;
}

export function storedSpanRow(tenantId: string, s: SpanFixture) {
  const attrs = spanAttributes(s);
  return {
    ProjectionId: `proj-${s.spanId}`,
    TenantId: tenantId,
    TraceId: s.traceId,
    SpanId: s.spanId,
    ParentSpanId: s.parentSpanId ?? null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(T0 + (s.startTimeOffsetMs ?? 0)),
    EndTime: new Date(T0 + (s.startTimeOffsetMs ?? 0) + 200),
    DurationMs: 200,
    SpanName: s.spanId,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: attrs,
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
    Cost: s.cost ?? null,
    NonBilledCost: s.nonBilledCost ?? null,
  };
}

/**
 * Synchronously delete the tenant's rows from the two fixture tables.
 * Used as a PRE-clean in beforeAll: an aborted previous run leaves its rows
 * behind (afterAll never ran), and a second fixture copy passes a
 * count-at-least read-back guard while failing every partition assertion at
 * exactly 2x. `mutations_sync = 1` so the delete completes before inserting
 * (the shared cleanupTestData helper's deletes are asynchronous mutations).
 */
export async function deleteTenantRowsSync({
  client,
  tenantId,
}: {
  client: ClickHouseClient;
  tenantId: string;
}): Promise<void> {
  for (const table of ["trace_summaries", "stored_spans"] as const) {
    await client.exec({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String} SETTINGS mutations_sync = 1`,
      query_params: { tenantId },
    });
  }
}
