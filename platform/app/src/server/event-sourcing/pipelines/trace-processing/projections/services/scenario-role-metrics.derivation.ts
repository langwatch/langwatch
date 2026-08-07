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
 * Nearest-ancestor role resolution for one span, memoized in `cache` across
 * the whole aggregation. Seeds the cache for the current chain to a sentinel
 * so a parent cycle (customer-emitted bad parent links) terminates instead
 * of recursing forever; resolved once the walk bottoms out.
 */
function resolveEffectiveRole({
  spanId,
  bySpanId,
  cache,
}: {
  spanId: string;
  bySpanId: Map<string, ScenarioRoleSpanInput>;
  cache: Map<string, string | null>;
}): string | null {
  const cached = cache.get(spanId);
  if (cached !== undefined) return cached;

  cache.set(spanId, null);

  const span = bySpanId.get(spanId);
  if (!span) return null;

  let resolved: string | null;
  if (span.role !== undefined && span.role !== "") {
    resolved = span.role;
  } else if (span.parentSpanId && bySpanId.has(span.parentSpanId)) {
    resolved = resolveEffectiveRole({
      spanId: span.parentSpanId,
      bySpanId,
      cache,
    });
  } else {
    resolved = null;
  }

  cache.set(spanId, resolved);
  return resolved;
}

function accumulateRoleCosts({
  spans,
  bySpanId,
  cache,
}: {
  spans: ScenarioRoleSpanInput[];
  bySpanId: Map<string, ScenarioRoleSpanInput>;
  cache: Map<string, string | null>;
}): Record<string, number> {
  const scenarioRoleCosts: Record<string, number> = {};
  for (const span of spans) {
    if (span.cost <= 0) continue;
    const role = resolveEffectiveRole({ spanId: span.spanId, bySpanId, cache });
    if (!role) continue;
    scenarioRoleCosts[role] = (scenarioRoleCosts[role] ?? 0) + span.cost;
  }
  return scenarioRoleCosts;
}

function accumulateRoleLatencies(
  spans: ScenarioRoleSpanInput[],
): Record<string, number> {
  const scenarioRoleLatencies: Record<string, number> = {};
  for (const span of spans) {
    if (span.role === undefined || span.role === "") continue;
    scenarioRoleLatencies[span.role] =
      (scenarioRoleLatencies[span.role] ?? 0) + span.durationMs;
  }
  return scenarioRoleLatencies;
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

  return {
    scenarioRoleCosts: accumulateRoleCosts({
      spans,
      bySpanId,
      cache: effectiveRoleCache,
    }),
    scenarioRoleLatencies: accumulateRoleLatencies(spans),
  };
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
