/**
 * Pure threshold evaluation for custom-graph alerts (ADR-034 Phase 5).
 *
 * The threshold logic the event-sourced evaluator
 * (`graph-trigger-evaluation.service.ts`) calls. Pure — no I/O, no side
 * effects, no dependency on Prisma or ClickHouse — so it composes into the
 * real-time and heartbeat paths and is trivial to unit-test. (Originally
 * extracted from the removed cron's `checkThreshold`.)
 *
 * `isNoDataPredicate` recognises every trigger shape that fires on total
 * silence — the case the event-driven path cannot reach (there is, by
 * definition, no event to react to), so the heartbeat scans for it
 * periodically.
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
 * Returns true when the trigger would BREACH on total silence — i.e. a
 * zero value satisfies its operator/threshold pair. These are the
 * triggers the event-driven path cannot fire on its own (an absence of
 * events produces no event), so the heartbeat scans for them.
 *
 * Defined as literally "does 0 breach?" for exact parity with the
 * legacy cron, which evaluated EVERY trigger each tick and therefore
 * fired any below-style rule on silence: `lt 10` fired (0 < 10), and
 * an earlier `threshold ≤ 1` cut-off here silently regressed exactly
 * those alerts — a metric going quiet never woke the real-time path
 * ("each new event re-runs the check" assumes events keep arriving),
 * and the heartbeat excluded them, so they never fired at all.
 */
export function isNoDataPredicate({
  operator,
  threshold,
}: {
  operator: string;
  threshold: number;
}): boolean {
  return evaluateCustomGraphThreshold({ value: 0, threshold, operator })
    .breached;
}
