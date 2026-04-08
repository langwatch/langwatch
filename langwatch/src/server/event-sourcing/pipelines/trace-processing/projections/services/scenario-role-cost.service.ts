import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";
import type { SpanCostService } from "./span-cost.service";

/**
 * Tracks per-role cost and latency for scenario traces.
 *
 * Roles are set on agent spans via `scenario.role`, but costs live on
 * child LLM spans. This service resolves each span's effective role by
 * walking the parent chain and retroactively assigning costs when the
 * parent agent span arrives after its children.
 */
export class ScenarioRoleCostService {
  constructor(private readonly spanCostService: SpanCostService) {}

  accumulateRoleCostLatency({
    state,
    span,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
  }): Pick<
    TraceSummaryData,
    | "scenarioRoleCosts"
    | "scenarioRoleLatencies"
    | "scenarioRoleSpans"
    | "spanCosts"
  > {
    const scenarioRoleSpans = { ...(state.scenarioRoleSpans ?? {}) };
    const spanCosts = { ...(state.spanCosts ?? {}) };

    // Track this span's cost and parent for retroactive role assignment
    const spanCost = this.spanCostService.extractTokenMetrics(span).cost;
    if (spanCost > 0) {
      spanCosts[span.spanId] = spanCost;
    }

    // Record parent relationship for retroactive role propagation.
    // Only stored in scenarioRoleSpans - not in spanCosts (which would
    // bloat the Map column with zero-value entries for every span).
    if (span.parentSpanId) {
      scenarioRoleSpans[`_parent:${span.spanId}`] = span.parentSpanId;
    }

    // Record this span's role if it has one
    const directRole = span.spanAttributes["scenario.role"];
    const isNewRoleSpan = typeof directRole === "string" && directRole !== "";

    if (isNewRoleSpan) {
      scenarioRoleSpans[span.spanId] = directRole;
      // Propagate role transitively to all descendants of this span.
      // Loops until no new assignments are made (transitive closure)
      // to handle arbitrarily deep nesting (e.g. Agent -> ai.generateText -> ai.generateText.doGenerate).
      let changed = true;
      while (changed) {
        changed = false;
        for (const key of Object.keys(scenarioRoleSpans)) {
          if (!key.startsWith("_parent:")) continue;
          const childId = key.slice("_parent:".length);
          const parentId = scenarioRoleSpans[key]!;
          if (scenarioRoleSpans[parentId] && !scenarioRoleSpans[childId]) {
            scenarioRoleSpans[childId] = scenarioRoleSpans[parentId]!;
            changed = true;
          }
        }
      }
    } else if (span.parentSpanId && scenarioRoleSpans[span.parentSpanId]) {
      scenarioRoleSpans[span.spanId] = scenarioRoleSpans[span.parentSpanId]!;
    }

    // Recompute ALL role costs from spanCosts + scenarioRoleSpans.
    // This handles the case where child LLM spans arrive before their
    // parent agent span - when the parent arrives and propagates its role,
    // all children's costs are retroactively assigned.
    const scenarioRoleCosts: Record<string, number> = {};
    for (const [sid, cost] of Object.entries(spanCosts)) {
      if (sid.startsWith("_parent:")) continue; // skip parent mappings
      const role = scenarioRoleSpans[sid];
      if (role && !role.startsWith("_parent:") && cost > 0) {
        scenarioRoleCosts[role] = (scenarioRoleCosts[role] ?? 0) + cost;
      }
    }

    // Latency: only from spans that directly carry the role attribute
    let scenarioRoleLatencies = state.scenarioRoleLatencies ?? {};
    if (isNewRoleSpan) {
      const spanDurationMs = span.endTimeUnixMs - span.startTimeUnixMs;
      scenarioRoleLatencies = {
        ...scenarioRoleLatencies,
        [directRole]: (scenarioRoleLatencies[directRole] ?? 0) + spanDurationMs,
      };
    }

    return {
      scenarioRoleCosts,
      scenarioRoleLatencies,
      scenarioRoleSpans,
      spanCosts,
    };
  }
}
