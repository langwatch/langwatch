import { type GroupKey, renderGroupKey } from "@langwatch/event-sourcing";

/**
 * The `simulationRunState` fold's dispatch-plane group key (ADR-100).
 *
 * `scope` is `aggregate`, keyed on `scenarioRunId` alone — never
 * `batchRunId` or `scenarioSetId`. This is the dispatch-layer half of defect
 * #2 ("dedup grouping must not be wider than the engine key"): the
 * function's own signature only accepts a `scenarioRunId`, so there is no
 * call site that could pass a batch or set id here even by mistake — the old
 * bug (`app-layer/simulations/repositories/simulationRuns.sql.ts`'s
 * `simulationRunDedupPredicate` docblock) happened on the *read* side, where
 * a dedup subquery's `GROUP BY` was widened to `(TenantId, ScenarioSetId,
 * BatchRunId, ScenarioRunId)` — wider than `simulation_runs`'s actual engine
 * key, `ORDER BY (TenantId, ScenarioRunId)`. Widening the *fold's* lane the
 * same way would be worse: ADR-100 requires `scope: aggregate` for every
 * fold precisely because two lanes sharing one aggregate's key race the
 * read-modify-write cycle and lose an update that no read-time dedup
 * recovers (ADR-106's `fold-scope-must-be-aggregate` rule). `batchAggregates.ts`
 * carries the read-side half of the same discipline.
 */
export function simulationRunFoldGroupKey(args: {
  readonly tenantId: string;
  readonly scenarioRunId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "simulationRunState" },
    scope: {
      kind: "aggregate",
      aggregateType: "simulation_run",
      aggregateId: args.scenarioRunId,
    },
  };
}

export function renderSimulationRunFoldGroupKey(args: {
  readonly tenantId: string;
  readonly scenarioRunId: string;
}): string {
  return renderGroupKey(simulationRunFoldGroupKey(args));
}
