/**
 * Pure row shaping for the trace list: the sort-column map, the summary row to list item mapping,
 * and the cursor a row yields for keyset pagination. Nothing here reads a store, so the list
 * service and its tests can exercise the shaping without one.
 */

import {
  deriveTraceOrigin,
  deriveTraceStatus,
  deriveTraceTimestamp,
  parseMediaRefs,
  RESERVED_INPUT_MEDIA_REFS,
  RESERVED_OUTPUT_MEDIA_REFS,
  resolveNonBilledCost,
  type TraceListCursor,
  type TraceListItem,
  type TraceListSort,
  type TraceListSortColumn,
  type TraceMediaRef,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

export const SORT_COLUMN_MAP: Record<string, TraceListSort["column"]> = {
  time: "OccurredAt",
  duration: "TotalDurationMs",
  cost: "TotalCost",
  spans: "SpanCount",
  tokens: "TotalTokens",
  ttft: "TimeToFirstTokenMs",
  tokensIn: "TotalPromptTokenCount",
  tokensOut: "TotalCompletionTokenCount",
  size: "_size_bytes",
};

/**
 * Decode the `langwatch.labels` attribute — a JSON-encoded array of
 * strings (e.g. `'["prod","beta"]'`) parked on the trace summary. A
 * missing or malformed value reads as no labels rather than throwing.
 */
export function parseLabels(raw: string | undefined): string[] {
  if (raw == null || raw === "") {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((label): label is string => typeof label === "string" && label !== "");
  } catch {
    return [];
  }
}

export function mapToTraceListItem(row: TraceSummaryData): TraceListItem {
  const status = deriveTraceStatus(row);

  const totalTokens = (row.totalPromptTokenCount ?? 0) + (row.totalCompletionTokenCount ?? 0);

  return {
    traceId: row.traceId,
    timestamp: deriveTraceTimestamp({
      occurredAt: row.occurredAt,
      storageAnchorMs: row.storageAnchorMs,
    }),
    name: row.attributes["langwatch.span.name"] ?? row.traceId.slice(0, 8),
    serviceName: row.attributes["service.name"] ?? "",
    durationMs: row.totalDurationMs,
    totalCost: row.totalCost ?? 0,
    nonBilledCost: resolveNonBilledCost({
      foldedNonBilledCost: row.nonBilledCost,
      totalCost: row.totalCost,
      attributes: row.attributes,
    }),
    totalTokens,
    inputTokens: row.totalPromptTokenCount,
    outputTokens: row.totalCompletionTokenCount,
    cacheReadTokens: parseTokenCount(row.attributes["langwatch.reserved.cache_read_tokens"]),
    cacheCreationTokens: parseTokenCount(
      row.attributes["langwatch.reserved.cache_creation_tokens"],
    ),
    reasoningTokens: parseTokenCount(row.attributes["langwatch.reserved.reasoning_tokens"]),
    contextSizeTokens: parseTokenCount(row.attributes["langwatch.reserved.context_size_tokens"]),
    models: row.models,
    labels: parseLabels(row.attributes["langwatch.labels"]),
    promptId: row.lastUsedPromptId,
    promptVersionNumber: row.lastUsedPromptVersionNumber,
    status,
    spanCount: row.spanCount,
    sizeBytes: row.sizeBytes ?? 0,
    input: row.computedInput,
    output: row.computedOutput,
    inputMediaRefs: presentMediaRefs(row.attributes[RESERVED_INPUT_MEDIA_REFS]),
    outputMediaRefs: presentMediaRefs(row.attributes[RESERVED_OUTPUT_MEDIA_REFS]),
    error: row.errorMessage,
    conversationId: row.attributes["gen_ai.conversation.id"] ?? null,
    userId: row.attributes["langwatch.user_id"] ?? null,
    origin: deriveTraceOrigin(row.attributes),
    tokensEstimated: row.tokensEstimated,
    ttft: row.timeToFirstTokenMs,
    traceName: row.traceName,
    rootSpanType: row.rootSpanType,
  };
}

/**
 * Parse a reserved-key token sum off the trace attribute map. The fold parks
 * these as strings; a non-finite or absent value reads as "not reported" (null)
 * so the hover hides the row rather than showing a zero.
 */
function parseTokenCount(raw: string | undefined): number | null {
  if (raw == null || raw === "") {
    return null;
  }

  const n = Number(raw);

  return Number.isFinite(n) ? n : null;
}

/** Keep this normalization in lockstep with `cursorSortExpression` in the CH repository. */
export function cursorForTraceRow(
  row: TraceSummaryData,
  sortColumn: TraceListSortColumn,
): TraceListCursor {
  let sortValue: number;
  switch (sortColumn) {
    case "OccurredAt":
      sortValue = row.occurredAt;
      break;
    case "TotalDurationMs":
      sortValue = row.totalDurationMs;
      break;
    case "TotalCost":
      sortValue = row.totalCost ?? 0;
      break;
    case "SpanCount":
      sortValue = row.spanCount;
      break;
    case "TotalTokens":
      sortValue = (row.totalPromptTokenCount ?? 0) + (row.totalCompletionTokenCount ?? 0);
      break;
    case "TimeToFirstTokenMs":
      sortValue = row.timeToFirstTokenMs ?? 0;
      break;
    case "TotalPromptTokenCount":
      sortValue = row.totalPromptTokenCount ?? 0;
      break;
    case "TotalCompletionTokenCount":
      sortValue = row.totalCompletionTokenCount ?? 0;
      break;
    case "_size_bytes":
      sortValue = row.sizeBytes ?? 0;
      break;
  }

  return {
    sortValue: Number.isFinite(sortValue) ? sortValue : 0,
    traceId: row.traceId,
  };
}

/** Parsed refs, or undefined so media-free rows serialize without the field. */
function presentMediaRefs(serialized: string | undefined): TraceMediaRef[] | undefined {
  const refs = parseMediaRefs(serialized);

  return refs.length > 0 ? refs : undefined;
}
