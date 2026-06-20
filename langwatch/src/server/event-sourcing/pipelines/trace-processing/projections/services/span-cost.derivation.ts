import type { NormalizedSpan } from "../../schemas/spans";
import { SpanCostService } from "./span-cost.service";

/**
 * Per-span cost split into billed-vs-bundled, derived at projection time so
 * `stored_spans` can carry a queryable `Cost` / `NonBilledCost` per span.
 *
 * Both figures come from the SAME `SpanCostService` the trace-summary fold and
 * the scenario-role derivation use, so a span's stored cost matches exactly
 * what it contributed to the trace total:
 *   - `cost` = `extractTokenMetrics(span).cost`
 *   - `nonBilledCost` = that cost when the span is classified non-billable
 *     (`langwatch.cost.non_billable` on the span or its resource), else 0,
 *     mirroring how `trace_summaries.NonBilledCost` is summed in the fold.
 *
 * A zero computed cost maps to `null` (the span carried no costable usage),
 * consistent with the fold returning `null` for a non-positive total.
 */
export function deriveSpanCost({
  span,
  spanCostService,
}: {
  span: NormalizedSpan;
  spanCostService: SpanCostService;
}): { cost: number | null; nonBilledCost: number | null } {
  const rawCost = spanCostService.extractTokenMetrics(span).cost;
  if (rawCost <= 0) {
    return { cost: null, nonBilledCost: null };
  }
  const cost = Number(rawCost.toFixed(6));
  const nonBilledCost = spanCostService.isSpanCostNonBillable(span)
    ? cost
    : null;
  return { cost, nonBilledCost };
}
