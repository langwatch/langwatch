/**
 * Pure threshold evaluation for custom-graph alerts (ADR-034 Phase 5).
 *
 * Extracted from the cron's `checkThreshold` in
 * `src/pages/api/cron/triggers/utils.ts` so the legacy cron and the new
 * event-sourced path (`graph-trigger-evaluation.service.ts`) call the
 * SAME function. Pure — no I/O, no side effects, no dependency on
 * Prisma or ClickHouse — so it composes into both paths and is trivial
 * to unit-test.
 *
 * `isNoDataPredicate` recognises the "fire when the metric drops to
 * zero" shape — the case the event-driven path cannot reach (there is,
 * by definition, no event to react to), so the heartbeat scans for it
 * periodically. Operators express it as `operator ∈ {"lt","lte","eq"}`
 * AND `threshold ≤ 1` so a threshold of 0 / "<=1" both qualify.
 */

export type CustomGraphOperator = "gt" | "gte" | "lt" | "lte" | "eq";

const EQ_EPSILON = 0.0001;

/**
 * Evaluates whether the current value breaches the operator/threshold
 * pair. Mirrors the cron's `checkThreshold` exactly, including the
 * floating-point epsilon used for `eq`.
 *
 * Unknown operators return `{ breached: false }` — same defensive
 * default the cron uses (a misconfigured operator must NOT fire).
 */
export function evaluateCustomGraphThreshold({
  value,
  threshold,
  operator,
}: {
  value: number;
  threshold: number;
  operator: string;
}): { breached: boolean } {
  switch (operator) {
    case "gt":
      return { breached: value > threshold };
    case "gte":
      return { breached: value >= threshold };
    case "lt":
      return { breached: value < threshold };
    case "lte":
      return { breached: value <= threshold };
    case "eq":
      return { breached: Math.abs(value - threshold) < EQ_EPSILON };
    default:
      return { breached: false };
  }
}

/**
 * Returns true when the trigger's operator/threshold combination
 * expresses "fire when the metric drops to ~zero". These are the
 * triggers the event-driven path cannot fire on its own (an absence of
 * events produces no event), so the heartbeat scans for them.
 *
 * Threshold ≤ 1 captures the operator-intent we care about — `lt 1`,
 * `lte 0`, `eq 0` all qualify. A `lt 100` is still a real "below"
 * trigger but is driven by the real-time path: each new event re-runs
 * the threshold check and fires/resolves accordingly.
 */
export function isNoDataPredicate({
  operator,
  threshold,
}: {
  operator: string;
  threshold: number;
}): boolean {
  if (operator !== "lt" && operator !== "lte" && operator !== "eq") {
    return false;
  }
  return threshold <= 1;
}
