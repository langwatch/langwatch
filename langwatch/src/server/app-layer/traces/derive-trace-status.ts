import type { TraceSummaryData } from "./types";

export type DerivedTraceStatus = "ok" | "error" | "warning";

/**
 * ClickHouse expression that produces the same value `deriveTraceStatus`
 * does — used by the status facet's distinct-value pre-aggregation and
 * the `status:` filter translator so the table, the sidebar, and the
 * search bar all agree on what counts as warning vs ok. Keep this in
 * lockstep with the TS function: a divergence between the two means
 * customers filtering `status:warning` get a row set the table won't
 * render as warning (or vice versa).
 */
export const TRACE_STATUS_CLICKHOUSE_EXPRESSION =
  "if(ContainsErrorStatus = 1, 'error', if(BlockedByGuardrail = 1, 'warning', 'ok'))";

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
