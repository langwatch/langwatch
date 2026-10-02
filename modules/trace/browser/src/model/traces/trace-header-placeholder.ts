import type { TraceHeader } from "@langwatch/trace-contract";

/*
 * The fields a list row carries toward the drawer header: placeholder only, never cached
 * under the header key (ARCHITECTURE.md 10.2). This names them until the contract does.
 */
export type TraceHeaderRow = Pick<
  TraceHeader,
  | "traceId"
  | "timestamp"
  | "name"
  | "serviceName"
  | "origin"
  | "durationMs"
  | "spanCount"
  | "status"
  | "input"
  | "output"
  | "models"
  | "totalCost"
  | "nonBilledCost"
  | "totalTokens"
  | "ttft"
  | "error"
> &
  Partial<
    Pick<
      TraceHeader,
      | "conversationId"
      | "userId"
      | "inputTokens"
      | "outputTokens"
      | "tokensEstimated"
      | "traceName"
      | "rootSpanType"
      | "inputRedacted"
      | "outputRedacted"
      | "inputVisibleTo"
      | "outputVisibleTo"
    >
  >;

/** The row painted as a header; what only the header read knows is left empty. */
export function traceHeaderPlaceholder(row: TraceHeaderRow): TraceHeader {
  return {
    traceId: row.traceId,
    timestamp: row.timestamp,
    name: row.name,
    serviceName: row.serviceName,
    origin: row.origin,
    conversationId: row.conversationId ?? null,
    userId: row.userId ?? null,
    durationMs: row.durationMs,
    spanCount: row.spanCount,
    status: row.status,
    error: row.error,
    input: row.input,
    output: row.output,
    inputRedacted: row.inputRedacted,
    outputRedacted: row.outputRedacted,
    inputVisibleTo: row.inputVisibleTo,
    outputVisibleTo: row.outputVisibleTo,
    models: row.models,
    totalCost: row.totalCost,
    nonBilledCost: row.nonBilledCost,
    totalTokens: row.totalTokens,
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
    tokensEstimated: row.tokensEstimated ?? false,
    ttft: row.ttft,
    traceName: row.traceName ?? "",
    rootSpanType: row.rootSpanType ?? null,
    scenarioRunId: null,
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    attributes: {},
  };
}
