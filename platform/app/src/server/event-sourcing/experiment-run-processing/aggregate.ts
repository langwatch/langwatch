import { defineAggregate } from "@langwatch/event-sourcing";
import {
  type ExperimentRunState,
  type ExperimentRunTarget,
  evaluatorResultDataSchema,
  experimentRunStateSchema,
  initExperimentRunState,
  runCompletedDataSchema,
  runStartedDataSchema,
  targetResultDataSchema,
} from "./schema";

/**
 * The `experiment_run` aggregate (ADR-105).
 *
 * One declaration replaces the old pipeline's four-site event declaration —
 * `schemas/constants.ts` (type strings, versions), `schemas/events.ts`
 * (payload + envelope + `z.infer`), `schemas/typeGuards.ts` (259 lines of
 * `event.type === CONSTANT` narrowing this pipeline no longer needs) and
 * `commands.ts` (`defineCommand` call sites). Everything nameable — the event
 * type string, the union, the router's `eventTypes` list, the typed
 * creators — is derived from the declaration below.
 *
 * === `evaluatorResultRecorded`'s apply is a no-op, on purpose ===
 *
 * Every effect the old fold gave this event was an incremented counter:
 * `TotalScoreSum`/`ScoreCount`/`PassedCount`/`GradedCount` and the two
 * derived `AvgScoreBps`/`PassRateBps` fields
 * (`event-sourcing.old/.../experimentRunState.foldProjection.ts:218-254`).
 * ADR-103 decision 1 retires every one of them to a read-time query over
 * `experiment_run_items` (`totals.ts`) — "a run's totals are a query over its
 * items, never counters on the run row." So this fold's state has nothing
 * left to compute from `evaluatorResultRecorded`. It stays a declared event
 * — with an identity `apply` — because the `experimentRunResultStorage` map
 * projection (`items.ts`) mounts on this same aggregate's event union and
 * needs it routed.
 *
 * === Order-invariance, and the one field that is not (ADR-098 decision 4) ===
 *
 * `total` is `Math.max` — commutative. `startedAt`/`finishedAt`/`stoppedAt`
 * are each written by an event that occurs at most once per run in practice
 * (`started`, `completed`), so first-write-wins/plain-overwrite converge
 * regardless of arrival order for the same reason the old fold's docblock
 * gave: there is never a second write to order against.
 *
 * `targets` is the exception, carried forward with the same caveat the old
 * fold's docblock stated rather than silently dropped: it is a keyed
 * last-write-wins merge (`mergeTargets` below), which is order-INVARIANT only
 * because each target id is, in practice, written once — one `targetResult`
 * per dataset row. Two events genuinely updating the same target id would
 * disagree depending on delivery order. This is inherited, not introduced —
 * closing it for real needs a per-field `asOf` stamp (ADR-099's prescribed
 * fix for exactly this shape), which is a real design change beyond this
 * rewrite's scope and is flagged rather than silently claimed as fixed.
 */

/**
 * Merges `incoming` targets into `existing`, keyed by id, last-write-wins.
 * See the module docblock's "Order-invariance" section for the one case this
 * does not cover.
 *
 * Sorted by `id` before returning rather than left in `Map` insertion order.
 * `checkOrderInvariance` caught the reason this matters: two events touching
 * *different*, non-conflicting target ids converge on the same resulting
 * *set* regardless of delivery order, but `Map` iteration order is insertion
 * order, so the resulting *array* did not — `[t1, t2]` folded one way,
 * `[t2, t1]` the other, and a plain array comparison treats those as
 * different states. Sorting removes that nondeterminism for free; it does
 * not touch the actual last-write-wins semantics the module docblock's
 * caveat is about (two events disagreeing about the *same* id).
 */
function mergeTargets(
  existing: readonly ExperimentRunTarget[],
  incoming: readonly ExperimentRunTarget[],
): ExperimentRunTarget[] {
  if (incoming.length === 0) return [...existing];
  const byId = new Map(existing.map((target) => [target.id, target] as const));
  for (const target of incoming) byId.set(target.id, target);
  return [...byId.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/**
 * Not pinned. `defineAggregate` derives `stateVersion` as a hash of
 * `experimentRunStateSchema`, which differs from the old fold's hand-typed
 * `"2025-02-01"` stamp — correctly: this state is a genuine narrowing (eleven
 * counter fields gone), not a byte-compatible re-declaration of the old row.
 * ADR-105 decision 4's "every existing fold pins at cutover" rule protects a
 * fold that is *replacing* a live one; this pipeline is not yet wired into
 * any composition root (no `pipeline.ts`/dispatch wiring exists for it, same
 * as every other pipeline already converted under this tree — see
 * `log-processing/projection.ts`'s docblock), so there is no live traffic for
 * an unpinned version to break yet. Pinning becomes the correct move at the
 * point something actually cuts this pipeline over — see this task's final
 * report for why that point has not been reached here.
 */
export const experimentRun = defineAggregate("experiment_run")
  .state(experimentRunStateSchema, initExperimentRunState)
  .events({
    started: {
      data: runStartedDataSchema,
      apply: (state: ExperimentRunState, data): ExperimentRunState => ({
        ...state,
        runId: data.runId,
        experimentId: data.experimentId,
        workflowVersionId: data.workflowVersionId ?? state.workflowVersionId,
        total: Math.max(state.total, data.total),
        targets: mergeTargets(state.targets, data.targets),
        startedAt: state.startedAt ?? data.occurredAt,
      }),
    },

    targetResultRecorded: {
      data: targetResultDataSchema,
      apply: (state: ExperimentRunState, data): ExperimentRunState => ({
        ...state,
        targets: mergeTargets(state.targets, data.targets ?? []),
      }),
    },

    /** See the module docblock — every old effect of this event is now a read-time query. */
    evaluatorResultRecorded: {
      data: evaluatorResultDataSchema,
      apply: (state: ExperimentRunState): ExperimentRunState => state,
    },

    completed: {
      data: runCompletedDataSchema,
      apply: (state: ExperimentRunState, data): ExperimentRunState => ({
        ...state,
        finishedAt: data.finishedAt ?? null,
        stoppedAt: data.stoppedAt ?? null,
      }),
    },
  })
  .commands({
    start: {
      input: runStartedDataSchema,
      handle: (_state, input, events) => [events.started(input)],
    },
    recordTargetResult: {
      input: targetResultDataSchema,
      handle: (_state, input, events) => [events.targetResultRecorded(input)],
    },
    recordEvaluatorResult: {
      input: evaluatorResultDataSchema,
      handle: (_state, input, events) => [
        events.evaluatorResultRecorded(input),
      ],
    },
    complete: {
      input: runCompletedDataSchema,
      handle: (_state, input, events) => [events.completed(input)],
    },
  })
  .build();

export type ExperimentRunAggregate = typeof experimentRun;

/**
 * The composite aggregate id, `${experimentId}:${runId}` — unchanged from the
 * old pipeline's `utils/compositeKey.ts`. `runId` slugs are not globally
 * unique (the same slug can appear across different experiments), so the
 * composite is what makes the id unique.
 *
 * Kept as a sibling function rather than a declaration field, matching
 * `log-processing/aggregate.ts`'s `logRecordAggregateId`: the shipped
 * `defineAggregate` (`packages/event-sourcing/src/aggregate/defineAggregate.ts`)
 * has no `.aggregateId()` step — see that file's docblock for the same
 * discrepancy against ADR-105's illustrative example.
 */
export function experimentRunAggregateId(args: {
  readonly experimentId: string;
  readonly runId: string;
}): string {
  return `${args.experimentId}:${args.runId}`;
}

/** The inverse of {@link experimentRunAggregateId}. */
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
