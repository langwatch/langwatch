import type {
  ExperimentRunState,
  ExperimentRunTarget,
  RunCompletedData,
  RunStartedData,
} from "./schema";

/**
 * The deployed stamp from `event-sourcing.old/pipelines/experiment-run-processing/schemas/constants.ts`
 * (`EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE`). The stored `experiment_runs`
 * row already carries every field this thinner state still reads — the eleven
 * counter columns ADR-103 decision 1 retires are simply no longer read — so a
 * live row is still decodable under the same stamp, and pinning it keeps every
 * existing run readable across the cutover instead of failing its version gate
 * on deploy.
 */
export const EXPERIMENT_RUN_STATE_VERSION_PIN = "2025-02-01";

/**
 * The run's declared targets, keyed by id and sorted. First declaration wins,
 * so a redelivered `started` cannot rewrite a target's metadata, and sorting
 * keeps two deliveries that declare different targets from producing arrays
 * that differ only in order.
 */
function mergeTargets(
  existing: readonly ExperimentRunTarget[],
  incoming: readonly ExperimentRunTarget[],
): ExperimentRunTarget[] {
  const byId = new Map(existing.map((target) => [target.id, target] as const));
  for (const target of incoming) {
    if (!byId.has(target.id)) byId.set(target.id, target);
  }
  return [...byId.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/**
 * Which experiment, which targets, when it started and how it ended. Every
 * count, sum and rate is a query over `experiment_run_items` (`totals.ts`),
 * never a counter here (ADR-103 decision 1) — `targetResult` and
 * `evaluatorResult` move no state at all, so this fold declares no handler
 * for either (ADR-105 decision 5).
 */
export function applyRunStarted(
  state: ExperimentRunState,
  data: RunStartedData,
): ExperimentRunState {
  return {
    ...state,
    runId: data.runId,
    experimentId: data.experimentId,
    workflowVersionId: state.workflowVersionId ?? data.workflowVersionId ?? null,
    total: Math.max(state.total, data.total),
    targets: mergeTargets(state.targets, data.targets),
    // The deployed partition column. Frozen on the first `started` this fold
    // observes: a value that moves files one row in two partitions, which a
    // ReplacingMergeTree never collapses.
    startedAt: state.startedAt ?? data.occurredAt,
  };
}

export function applyRunCompleted(
  state: ExperimentRunState,
  data: RunCompletedData,
): ExperimentRunState {
  return {
    ...state,
    runId: state.runId || data.runId,
    experimentId: state.experimentId || data.experimentId,
    // Frozen on the first `completed` this fold observes — a run has at most
    // one terminal event in practice, and a redelivery that omits a field
    // must never blank one an earlier delivery already established.
    finishedAt: state.finishedAt ?? data.finishedAt ?? null,
    stoppedAt: state.stoppedAt ?? data.stoppedAt ?? null,
  };
}
