import { defineAggregate } from "@langwatch/event-sourcing";
import {
  type ExperimentRunTarget,
  evaluatorResultDataSchema,
  experimentRunStateSchema,
  initExperimentRunState,
  runCompletedDataSchema,
  runStartedDataSchema,
  targetResultDataSchema,
} from "./schema";

/** The earlier of two observations, either of which may be unknown. */
function earliest(
  existing: number | null,
  incoming: number | null | undefined,
): number | null {
  if (incoming == null) return existing;
  return existing === null ? incoming : Math.min(existing, incoming);
}

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
 * The `experiment_run` fold: which experiment, which targets, when it started
 * and how it ended. Every count, sum and rate a customer sees is a query over
 * `experiment_run_items` (`totals.ts`), never a counter here — there is
 * nothing left for a redelivery to double-count (ADR-103 decision 1).
 *
 * `targetResult` and `evaluatorResult` therefore move no state at all. They
 * stay declared because the item-storage map projection subscribes to them.
 */
export const experimentRun = defineAggregate({
  name: "experiment_run",
  prefix: "lw",
  state: experimentRunStateSchema,
  init: initExperimentRunState,
  // RunId slugs are not unique across experiments, so the id is the composite.
  id: (data) => `${data.experimentId}:${data.runId}`,

  events: {
    started: {
      data: runStartedDataSchema,
      apply: (state, data) => ({
        ...state,
        runId: data.runId,
        experimentId: data.experimentId,
        workflowVersionId: state.workflowVersionId ?? data.workflowVersionId ?? null,
        total: Math.max(state.total, data.total),
        targets: mergeTargets(state.targets, data.targets),
        startedAt: earliest(state.startedAt, data.occurredAt),
      }),
    },

    targetResult: {
      data: targetResultDataSchema,
      apply: (state) => state,
    },

    evaluatorResult: {
      data: evaluatorResultDataSchema,
      apply: (state) => state,
    },

    completed: {
      data: runCompletedDataSchema,
      apply: (state, data) => ({
        ...state,
        runId: state.runId || data.runId,
        experimentId: state.experimentId || data.experimentId,
        finishedAt: earliest(state.finishedAt, data.finishedAt),
        stoppedAt: earliest(state.stoppedAt, data.stoppedAt),
      }),
    },
  },

  commands: {
    start: {
      input: runStartedDataSchema,
      handle: (_state, input, events) => [events.started(input)],
    },
    recordTargetResult: {
      input: targetResultDataSchema,
      handle: (_state, input, events) => [events.targetResult(input)],
    },
    recordEvaluatorResult: {
      input: evaluatorResultDataSchema,
      handle: (_state, input, events) => [events.evaluatorResult(input)],
    },
    complete: {
      input: runCompletedDataSchema,
      handle: (_state, input, events) => [events.completed(input)],
    },
  },
});

export type ExperimentRunAggregate = typeof experimentRun;

/** The inverse of {@link experimentRun.id}, for the store's two-column read. */
export function parseExperimentRunAggregateId(compositeKey: string): {
  experimentId: string;
  runId: string;
} {
  const separatorIndex = compositeKey.indexOf(":");
  if (separatorIndex === -1) return { experimentId: "", runId: compositeKey };
  return {
    experimentId: compositeKey.slice(0, separatorIndex),
    runId: compositeKey.slice(separatorIndex + 1),
  };
}
