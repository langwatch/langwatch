export type DerivedTraceStatus = "ok" | "error" | "warning";

export type TraceStatusSummary = {
  containsErrorStatus: boolean;
  blockedByGuardrail: boolean;
};

/**
 * ClickHouse expression must match `deriveTraceStatus` exactly: used by status facet
 * and filter translator so UI, table, and search bar show consistent trace status.
 */
export const TRACE_STATUS_CLICKHOUSE_EXPRESSION =
  "if(ContainsErrorStatus = 1, 'error', if(BlockedByGuardrail = 1, 'warning', 'ok'))";

/**
 * Single source of truth for trace status across UI surfaces. UNSET defaults to
 * "ok" (SDKs rarely upgrade from UNSET); "warning" for explicit mid-state signals.
 */
export function deriveTraceStatus(summary: TraceStatusSummary): DerivedTraceStatus {
  if (summary.containsErrorStatus) {
    return "error";
  }

  if (summary.blockedByGuardrail) {
    return "warning";
  }

  return "ok";
}
