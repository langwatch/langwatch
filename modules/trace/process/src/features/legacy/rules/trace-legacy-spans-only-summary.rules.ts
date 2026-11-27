import type { NormalizedSpan, TraceSummaryData } from "@langwatch/trace-contract";

/** OTel's ERROR status code, as stored. */
const STATUS_ERROR = 2;
/** OTel's OK status code, as stored. */
const STATUS_OK = 1;

/** The attribute a spans-only read stamps, so every reader can tell the trace is partial. */
export const STILL_INGESTING_ATTRIBUTE = "langwatch.read.still_ingesting";

/**
 * The summary a trace has before its summary row is written: timings, status and name from the
 * stored spans; computed input, output, cost and tokens stay empty until the fold writes them.
 */
export function summaryFromStoredSpans({
  traceId,
  spans,
  nowMs,
}: {
  traceId: string;
  spans: readonly NormalizedSpan[];
  nowMs: number;
}): TraceSummaryData {
  const starts = spans.map((span) => span.startTimeUnixMs);
  const ends = spans.map((span) => span.endTimeUnixMs);
  const startedAt = starts.length > 0 ? Math.min(...starts) : 0;
  const endedAt = ends.length > 0 ? Math.max(...ends) : startedAt;
  const spanIds = new Set(spans.map((span) => span.spanId));
  const root =
    spans.find((span) => !span.parentSpanId || !spanIds.has(span.parentSpanId)) ?? spans[0];
  const failed = spans.find((span) => span.statusCode === STATUS_ERROR);

  return {
    traceId,
    spanCount: spans.length,
    totalDurationMs: Math.max(0, endedAt - startedAt),
    computedIOSchemaVersion: "",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: failed !== undefined,
    containsOKStatus: spans.some((span) => span.statusCode === STATUS_OK),
    errorMessage: failed?.statusMessage ?? null,
    models: [],
    totalCost: null,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    traceName: root?.name ?? "",
    attributes: { [STILL_INGESTING_ATTRIBUTE]: "true" },
    storageAnchorMs: startedAt,
    occurredAt: startedAt,
    createdAt: nowMs,
    updatedAt: nowMs,
    LastEventOccurredAt: 0,
  };
}
