import type { SpanSummaryRow } from "~/server/app-layer/traces/repositories/span-storage.repository";

import type { SpanTreeNode } from "./tracesV2.schemas";

/**
 * The legacy whole-tree and shared-trace transports still read their own
 * bounded summary anchor. Cursor-paged and delta reads use TraceService.
 */
export function mapLegacySpanSummaryToTreeNode(row: SpanSummaryRow): SpanTreeNode {
  let status: SpanTreeNode["status"] = "unset";
  if (row.statusCode === 2) {
    status = "error";
  } else if (row.statusCode === 1) {
    status = "ok";
  }

  return {
    spanId: row.spanId,
    parentSpanId: row.parentSpanId,
    name: row.spanName,
    type: row.spanType,
    startTimeMs: row.startTimeMs,
    endTimeMs: row.startTimeMs + row.durationMs,
    durationMs: row.durationMs,
    status,
    model: row.model,
    toolName: row.toolName,
    cost: row.cost,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    updatedAtMs: row.updatedAtMs,
  };
}
