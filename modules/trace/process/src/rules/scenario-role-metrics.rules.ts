import type { NormalizedSpan } from "@langwatch/trace-contract";

import type { SpanCostService } from "../services/span-cost.service.ts";

// Minimal shape for scenario role cost/latency aggregation; decoupled from
// NormalizedSpan so the aggregator is pure and dependency-free
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

// Read-time aggregation of per-role cost/latency; role lives on descendants,
// effective role is nearest ancestor carrying one
type RoleResolution = Readonly<{
  bySpanId: Record<string, ScenarioRoleSpanInput>;
  cache: Record<string, string | null>;
}>;

/**
 * The role a span inherits from the nearest ancestor that declares one. The cache is seeded to
 * a sentinel for the chain in progress so a parent cycle (customer-emitted bad parent links)
 * terminates instead of recursing forever.
 */
function deriveEffectiveRole(resolution: RoleResolution, spanId: string): string | null {
  const cached = resolution.cache[spanId];
  if (cached !== undefined) return cached;

  resolution.cache[spanId] = null;

  const span = resolution.bySpanId[spanId];
  if (!span) return null;

  const resolved = extractDeclaredRole(span) ?? deriveInheritedRole(resolution, span);
  resolution.cache[spanId] = resolved;

  return resolved;
}

/** The role a span declares itself, or none when it declares nothing. */
function extractDeclaredRole(span: ScenarioRoleSpanInput): string | null {
  return span.role !== undefined && span.role !== "" ? span.role : null;
}

function deriveInheritedRole(
  resolution: RoleResolution,
  span: ScenarioRoleSpanInput,
): string | null {
  if (!span.parentSpanId) return null;
  if (resolution.bySpanId[span.parentSpanId] === undefined) return null;

  return deriveEffectiveRole(resolution, span.parentSpanId);
}

export function aggregateScenarioRoleMetrics(spans: ScenarioRoleSpanInput[]): ScenarioRoleMetrics {
  const bySpanId: Record<string, ScenarioRoleSpanInput> = Object.create(null);
  for (const span of spans) {
    bySpanId[span.spanId] = span;
  }
  const resolution: RoleResolution = { bySpanId, cache: Object.create(null) };

  const scenarioRoleCosts: Record<string, number> = {};
  const scenarioRoleLatencies: Record<string, number> = {};

  for (const span of spans) {
    if (span.cost > 0) {
      const role = deriveEffectiveRole(resolution, span.spanId);
      if (role) {
        scenarioRoleCosts[role] = (scenarioRoleCosts[role] ?? 0) + span.cost;
      }
    }

    const declared = extractDeclaredRole(span);
    if (declared) {
      scenarioRoleLatencies[declared] = (scenarioRoleLatencies[declared] ?? 0) + span.durationMs;
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
