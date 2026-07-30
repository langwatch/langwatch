import type { NormalizedSpan } from "./ingest/normalizedSpan";
import type { SpanCostService } from "./span-cost.service";

interface ScenarioRoleSpanInput {
  spanId: string;
  parentSpanId: string | null;
  /** The span's own `scenario.role`, when it carries one directly. */
  role: string | undefined;
  cost: number;
  durationMs: number;
}

export interface ScenarioRoleMetrics {
  scenarioRoleCosts: Record<string, number>;
  scenarioRoleLatencies: Record<string, number>;
}

/**
 * A role is declared on agent spans via `scenario.role`, but the cost lives on
 * descendant LLM spans. A span's effective role is its nearest ancestor (or
 * itself) carrying a direct role; cost sums per effective role, latency only
 * over spans that carry the role directly.
 *
 * Read-time, over the COMPLETE span set, so role resolution is one memoized
 * O(n) nearest-ancestor walk instead of the retroactive propagation an
 * incremental fold needed for out-of-order arrival.
 */
function aggregateScenarioRoleMetrics(
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

    // Seed with a sentinel so a customer-emitted parent cycle terminates
    // instead of recursing forever; resolved below.
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
