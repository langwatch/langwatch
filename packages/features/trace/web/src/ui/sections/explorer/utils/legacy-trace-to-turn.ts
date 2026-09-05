import type { Trace } from "@langwatch/trace-contract";
import { NO_TRACE_EVENTS, type TraceListItem } from "../types/trace";

/** The numbers the turn separator reads out: time, cost, tokens. */
type TurnLedger = Pick<
  TraceListItem,
  | "durationMs"
  | "ttft"
  | "totalCost"
  | "nonBilledCost"
  | "totalTokens"
  | "inputTokens"
  | "outputTokens"
  | "tokensEstimated"
>;

/**
 * Reads a single fetched trace as one conversation turn.
 */
export function legacyTraceToTurn(trace: Trace): TraceListItem {
  const metadata = trace.metadata;

  return {
    traceId: trace.trace_id,
    timestamp: trace.timestamps.started_at,
    // Same shorthand the trace header falls back to when no span name was
    // recorded, so the turn is named the way the rest of the drawer names it.
    name: trace.trace_id.slice(0, 8),
    serviceName: "",
    origin: "application",
    ...turnLedger(trace.metrics),
    models: [],
    labels: metadata?.labels ?? [],
    status: trace.error ? "error" : "ok",
    error: trace.error?.message,
    spanCount: trace.spans?.length ?? 0,
    sizeBytes: 0,
    input: trace.input?.value ?? null,
    output: trace.output?.value ?? null,
    conversationId: metadata?.thread_id ?? undefined,
    userId: metadata?.user_id ?? undefined,
    evaluations: [],
    events: NO_TRACE_EVENTS,
  };
}

function turnLedger(metrics: Trace["metrics"]): TurnLedger {
  const promptTokens = metrics?.prompt_tokens ?? undefined;
  const completionTokens = metrics?.completion_tokens ?? undefined;

  return {
    durationMs: metrics?.total_time_ms ?? 0,
    ttft: metrics?.first_token_ms ?? undefined,
    totalCost: metrics?.total_cost ?? 0,
    nonBilledCost: 0,
    totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0),
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    tokensEstimated: metrics?.tokens_estimated ?? undefined,
  };
}
