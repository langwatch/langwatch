import { type GroupKey, renderGroupKey } from "@langwatch/event-sourcing";

/**
 * Dispatch-plane keys for the `experiment_run` aggregate (ADR-100).
 *
 * Two lanes, two different scopes, for the reason ADR-100 decision 2 states:
 * scope is the ordering contract and the batching contract at once.
 *
 * - The **`experimentRunState` fold** is scoped to the aggregate — one lane
 *   per run — which `fold-scope-must-be-aggregate` (ADR-106) requires
 *   outright: two concurrent applies to one run's row would race the
 *   read-modify-write cycle.
 * - The **`experimentRunResultStorage` map** is scoped narrower than the
 *   aggregate, one lane per dataset row: `partition([experimentId, runId,
 *   index])`. This is the old pipeline's `groupKeyFn` —
 *   `` `experiment:${experimentId}:result:${runId}:item:${index}` ``
 *   (`experimentRunResultStorage.mapProjection.ts:69-72`) — carried forward
 *   as a `parts` array rather than a hand-concatenated string, which is
 *   exactly what ADR-100 decision 1 changes: nothing downstream of the
 *   descriptor concatenates, so a value inside `experimentId`/`runId`
 *   containing the old separator can no longer collide two different rows'
 *   lanes.
 */

export function experimentRunStateGroupKey(args: {
  readonly tenantId: string;
  readonly aggregateId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "experimentRunState" },
    scope: {
      kind: "aggregate",
      aggregateType: "experiment_run",
      aggregateId: args.aggregateId,
    },
  };
}

/** The rendered lane id — the only string form this pipeline produces, and only through the package's renderer (ADR-100 decision 3). */
export function renderExperimentRunStateGroupKey(args: {
  readonly tenantId: string;
  readonly aggregateId: string;
}): string {
  return renderGroupKey(experimentRunStateGroupKey(args));
}

export function experimentRunResultStorageGroupKey(args: {
  readonly tenantId: string;
  readonly experimentId: string;
  readonly runId: string;
  readonly index: number;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "experimentRunResultStorage" },
    scope: {
      kind: "partition",
      parts: [args.experimentId, args.runId, String(args.index)],
    },
  };
}

/** The rendered lane id — the only string form this pipeline produces, and only through the package's renderer (ADR-100 decision 3). */
export function renderExperimentRunResultStorageGroupKey(args: {
  readonly tenantId: string;
  readonly experimentId: string;
  readonly runId: string;
  readonly index: number;
}): string {
  return renderGroupKey(experimentRunResultStorageGroupKey(args));
}
