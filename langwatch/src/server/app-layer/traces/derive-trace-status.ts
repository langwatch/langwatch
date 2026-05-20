import type { TraceSummaryData } from "./types";

export type DerivedTraceStatus = "ok" | "error" | "warning";

/**
 * Map a projected `TraceSummaryData` to the user-facing trace status
 * pill / row tint. Single source of truth — both the trace list mapper
 * and the trace drawer header derive from here so the two surfaces
 * can't drift.
 *
 * Why UNSET reads as "ok": OpenTelemetry's `StatusCode` defaults to
 * UNSET. Most SDK instrumentation (LangChain, LangGraph, Genkit,
 * Mastra, direct OpenAI/Anthropic clients, etc.) never upgrades it to
 * OK on success — only ERROR on failure. A previous derivation treated
 * "no OK seen" as `warning`, which on 2026-05-20 was firing for 118k
 * of the 327k traces ingested in the last 7 days, drowning every
 * customer's table in yellow chips for plain successful runs.
 *
 * `warning` is reserved for explicit mid-state signals where the trace
 * ran but the outcome is qualified — currently just guardrail blocks.
 * Future signals (rate limits, partial responses) plug in here.
 */
export function deriveTraceStatus(
  summary: Pick<
    TraceSummaryData,
    "containsErrorStatus" | "blockedByGuardrail"
  >,
): DerivedTraceStatus {
  if (summary.containsErrorStatus) return "error";
  if (summary.blockedByGuardrail) return "warning";
  return "ok";
}
