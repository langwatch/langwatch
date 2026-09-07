import type { NormalizedSpan } from "../../schemas/spans";
import type { SpanCostService } from "./span-cost.service";

/**
 * Minimal per-span shape needed to aggregate scenario role cost/latency.
 * Decoupled from NormalizedSpan so the aggregator is a pure, dependency-free
 * function: the caller resolves cost (which needs model-cost matching) and
 * passes it in.
 */
export interface ScenarioRoleSpanInput {
  spanId: string;
  parentSpanId: string | null;
  /** Value of the `scenario.role` attribute, if the span carries one directly. */
  role: string | undefined;
  /** Per-span cost contribution (already model-cost-matched by the caller). */
  cost: number;
  durationMs: number;
}

export interface ScenarioRoleMetrics {
  scenarioRoleCosts: Record<string, number>;
  scenarioRoleLatencies: Record<string, number>;
}

/**
 * Aggregates per-role cost and latency for scenario traces from the COMPLETE
 * set of spans.
 *
 * A role is declared on agent spans via `scenario.role`, but the cost lives on
 * descendant LLM spans. A span's effective role is its nearest ancestor (or
 * itself) carrying a direct role; cost is summed per effective role, latency
 * only over spans that directly carry the role.
 *
 * This is the read-time counterpart of the per-event fold bookkeeping that
 * used to accumulate `scenarioRoleSpans` + `spanCosts` on the trace summary.
 * Because the whole span set is present here, role resolution is a single
 * O(n) nearest-ancestor walk (memoized) rather than the incremental
 * retroactive propagation the fold needed for out-of-order arrival — keeping
 * the fold state O(1) per event instead of growing with span count.
 */
export function aggregateScenarioRoleMetrics(
  spans: ScenarioRoleSpanInput[],
): ScenarioRoleMetrics {
  const bySpanId = new Map<string, ScenarioRoleSpanInput>();
  for (const span of spans) {
    bySpanId.set(span.spanId, span);
  }

  const effectiveRoleCache = new Map<string, string | null>();

  function effectiveRole(spanId: string): string | null {
    const cached = effectiveRoleCache.get(spanId);
    if (cached !== undefined) return cached;

    // Seed the cache for the current chain to a sentinel so a parent cycle
    // (customer-emitted bad parent links) terminates instead of recursing
    // forever; resolved below.
    effectiveRoleCache.set(spanId, null);

    const span = bySpanId.get(spanId);
    if (!span) return null;

    let resolved: string | null;
    if (span.role !== undefined && span.role !== "") {
      resolved = span.role;
    } else if (span.parentSpanId && bySpanId.has(span.parentSpanId)) {
      resolved = effectiveRole(span.parentSpanId);
    } else {
      resolved = null;
    }

    effectiveRoleCache.set(spanId, resolved);
    return resolved;
  }

  const scenarioRoleCosts: Record<string, number> = {};
  const scenarioRoleLatencies: Record<string, number> = {};

  for (const span of spans) {
    if (span.cost > 0) {
      const role = effectiveRole(span.spanId);
      if (role) {
        scenarioRoleCosts[role] = (scenarioRoleCosts[role] ?? 0) + span.cost;
      }
    }
    if (span.role !== undefined && span.role !== "") {
      scenarioRoleLatencies[span.role] =
        (scenarioRoleLatencies[span.role] ?? 0) + span.durationMs;
    }
  }

  return { scenarioRoleCosts, scenarioRoleLatencies };
}

/**
 * Adapter: derives scenario role metrics from full NormalizedSpans, resolving
 * each span's cost via the same SpanCostService the fold uses (so values match
 * what the per-event fold produced).
 */
export function deriveScenarioRoleMetricsFromSpans({
  spans,
  spanCostService,
}: {
  spans: NormalizedSpan[];
  spanCostService: SpanCostService;
}): ScenarioRoleMetrics {
  const inputs: ScenarioRoleSpanInput[] = spans.map((span) => {
    const role = span.spanAttributes["scenario.role"];
    return {
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      role: typeof role === "string" && role !== "" ? role : undefined,
      cost: spanCostService.extractTokenMetrics(span).cost,
      durationMs: span.endTimeUnixMs - span.startTimeUnixMs,
    };
  });

  return aggregateScenarioRoleMetrics(inputs);
}
