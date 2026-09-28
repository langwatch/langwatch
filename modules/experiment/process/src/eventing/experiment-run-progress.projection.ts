import {
  AbstractFoldProjection,
  type FoldEventHandlers,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import { type ExecutionSummary, UNNAMED_FAILURE } from "@langwatch/experiment-contract";

import type { ExperimentRunProgressState } from "../repositories/experiment-run-fold.repository.ts";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../rules/experiment-run-event-types.rules.ts";
import { appendRunFrames, findRunEventFrames } from "../rules/experiment-run-frames.rules.ts";
import { foldEvaluatorsOf, runCellKey } from "../rules/experiment-run-plan.rules.ts";
import { hasFinished, markFinished } from "../rules/experiment-run-window.rules.ts";
import {
  type CellFinishedEvent,
  cellFinishedEventSchema,
  type EvaluatorResultEvent,
  evaluatorResultEventSchema,
  type ExperimentRunCompletedEvent,
  experimentRunCompletedEventSchema,
  type ExperimentRunProcessingEvent,
  type ExperimentRunStartedEvent,
  experimentRunStartedEventSchema,
  type TargetResultEvent,
  targetResultEventSchema,
} from "./experiment-run-events.process.ts";

const experimentRunProgressEvents = [
  experimentRunStartedEventSchema,
  targetResultEventSchema,
  evaluatorResultEventSchema,
  cellFinishedEventSchema,
  experimentRunCompletedEventSchema,
] as const;

type TimestampKeys = "CreatedAt" | "UpdatedAt" | "LastEventOccurredAt";

/**
 * A run as it goes (ARCHITECTURE §9, D2 and the 2026-09-28 frame ruling): main's poller JSON with
 * its counts, the frames each event streams numbered by `seq`, and each target's output, trace and
 * verdicts per row for a comparison cell. Counts and status are idempotent under redelivery.
 */
export class ExperimentRunProgressFoldProjection
  extends AbstractFoldProjection<ExperimentRunProgressState, typeof experimentRunProgressEvents>
  implements FoldEventHandlers<typeof experimentRunProgressEvents, ExperimentRunProgressState>
{
  readonly name = "experimentRunProgress";
  readonly version = EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_PROGRESS;
  readonly store: FoldProjectionStore<ExperimentRunProgressState>;
  /** Unbatched, so a subscriber's delivery carries the state right after its own event. */
  readonly options = { refoldOnOutOfOrder: false, coalesceMaxBatch: 1 } as const;

  protected readonly events = experimentRunProgressEvents;

  static create(deps: {
    store: FoldProjectionStore<ExperimentRunProgressState>;
  }): ExperimentRunProgressFoldProjection {
    return new ExperimentRunProgressFoldProjection(deps);
  }

  private constructor(deps: { store: FoldProjectionStore<ExperimentRunProgressState> }) {
    super();
    this.store = deps.store;
  }

  protected initState(): Omit<ExperimentRunProgressState, TimestampKeys> {
    return {
      projectId: "",
      runId: "",
      experimentId: "",
      planned: false,
      phaseOneCells: 0,
      evaluators: {},
      finishedCells: "",
      targetOutputs: {},
      traceIds: {},
      evaluatorScores: {},
      experimentSlug: "",
      status: "pending",
      progress: 0,
      total: 0,
      startedAt: 0,
      recentEvents: [],
      seq: 0,
      failed: 0,
      persistResults: false,
      resultFrames: {},
    };
  }

  /** A redelivered start changes nothing, so a finished run never reads as running again. */
  handleExperimentRunStarted(
    event: ExperimentRunStartedEvent,
    state: ExperimentRunProgressState,
  ): ExperimentRunProgressState {
    if (state.status !== "pending") return state;

    const plan = event.data.plan;
    return this.streamed({
      event,
      state: {
        ...state,
        projectId: String(event.tenantId),
        runId: event.data.runId,
        experimentId: event.data.experimentId,
        planned: plan !== undefined,
        phaseOneCells: plan?.cells.filter((cell) => cell.phase === 1).length ?? 0,
        evaluators: plan ? foldEvaluatorsOf(plan) : {},
        experimentSlug: plan?.experimentSlug ?? "",
        status: "running",
        total: event.data.total,
        startedAt: event.occurredAt,
        ...(plan?.runUrl ? { runUrl: plan.runUrl } : {}),
        persistResults: Boolean(plan?.persistResults) && event.data.experimentId !== "",
      },
    });
  }

  /** A produced output is kept for the comparisons; a carried board cell is not. */
  handleExperimentRunTargetResult(
    event: TargetResultEvent,
    state: ExperimentRunProgressState,
  ): ExperimentRunProgressState {
    const { data } = event;
    if (data.carriedOver) return this.streamed({ event, state });

    const key = runCellKey({ rowIndex: data.index, targetId: data.targetId });
    const traceIds = data.traceId ? { ...state.traceIds, [key]: data.traceId } : state.traceIds;
    const output = data.predicted?.output;
    if (data.error || output === null || output === undefined) {
      return this.streamed({ event, state: { ...state, traceIds }, resultKey: `target:${key}` });
    }

    return this.streamed({
      event,
      resultKey: `target:${key}`,
      state: {
        ...state,
        traceIds,
        targetOutputs: {
          ...state.targetOutputs,
          [key]: {
            output,
            ...(data.cost != null ? { cost: data.cost } : {}),
            ...(data.duration != null ? { duration: data.duration } : {}),
          },
        },
      },
    });
  }

  /** A scored verdict, named as main named it; a comparison's own verdict is never kept. */
  handleExperimentRunEvaluatorResult(
    event: EvaluatorResultEvent,
    state: ExperimentRunProgressState,
  ): ExperimentRunProgressState {
    const { data } = event;
    if (data.carriedOver) return this.streamed({ event, state });

    const key = runCellKey({ rowIndex: data.index, targetId: data.targetId });
    const resultKey = `evaluator:${key}:${data.evaluatorId}`;
    const evaluator = state.evaluators[data.evaluatorId];
    if (data.status !== "processed" || !evaluator || evaluator.comparison) {
      return this.streamed({ event, state, resultKey });
    }

    const name = (evaluator.recordNamed ? data.evaluatorName : undefined) ?? evaluator.fallbackName;
    return this.streamed({
      event,
      resultKey,
      state: {
        ...state,
        evaluatorScores: {
          ...state.evaluatorScores,
          [key]: {
            ...state.evaluatorScores[key],
            [data.evaluatorId]: {
              name,
              ...(data.score != null ? { score: data.score } : {}),
              ...(data.label != null ? { label: data.label } : {}),
              ...(data.passed != null ? { passed: data.passed } : {}),
            },
          },
        },
      },
    });
  }

  /** Counted once per cell: a redelivered finish neither recounts nor streams progress again. */
  handleExperimentRunCellFinished(
    event: CellFinishedEvent,
    state: ExperimentRunProgressState,
  ): ExperimentRunProgressState {
    const { ordinal, outcome } = event.data;
    const newlyFinished = !hasFinished({ bitmap: state.finishedCells, ordinal });
    return this.streamed({
      event,
      newlyFinished,
      state: {
        ...state,
        finishedCells: markFinished({ bitmap: state.finishedCells, ordinal }),
        progress: state.progress + (newlyFinished ? 1 : 0),
        failed: state.failed + (newlyFinished && outcome === "failed" ? 1 : 0),
      },
    });
  }

  /** Main's terminal states: completed with its summary, stopped, or failed with the code. */
  handleExperimentRunCompleted(
    event: ExperimentRunCompletedEvent,
    state: ExperimentRunProgressState,
  ): ExperimentRunProgressState {
    if (state.status !== "running") return state;

    const { outcome, error } = event.data;
    const finishedAt = event.data.finishedAt ?? event.data.stoppedAt ?? event.occurredAt;
    if (outcome === "stopped") {
      return this.streamed({ event, state: { ...state, status: "stopped", finishedAt } });
    }
    if (outcome === "failed") {
      const failed = {
        ...state,
        status: "failed" as const,
        finishedAt,
        error: error?.code ?? UNNAMED_FAILURE,
        ...(error ? { domainError: error } : {}),
        ...(error?.traceId ? { traceId: error.traceId } : {}),
      };
      return this.streamed({ event, state: failed });
    }

    const summary: ExecutionSummary = {
      runId: state.runId,
      totalCells: state.total,
      completedCells: state.progress - state.failed,
      failedCells: state.failed,
      duration: finishedAt - state.startedAt,
      timestamps: { startedAt: state.startedAt, finishedAt },
    };
    return this.streamed({
      event,
      summary,
      state: {
        ...state,
        status: "completed",
        finishedAt,
        summary: { ...summary, ...(state.runUrl ? { runUrl: state.runUrl } : {}) },
      },
    });
  }

  /** The state with the frames `event` streams numbered onto it, and its result kept if asked. */
  private streamed({
    event,
    state,
    resultKey,
    newlyFinished = false,
    summary,
  }: {
    event: ExperimentRunProcessingEvent;
    state: ExperimentRunProgressState;
    resultKey?: string;
    newlyFinished?: boolean;
    summary?: ExecutionSummary;
  }): ExperimentRunProgressState {
    const frames = findRunEventFrames({
      event,
      run: {
        progress: state.progress,
        total: state.total,
        cellNewlyFinished: newlyFinished,
        evaluators: state.evaluators,
        ...(summary ? { summary } : {}),
      },
    });
    const [result] = frames;
    const keepsResult = resultKey !== undefined && result !== undefined && state.persistResults;
    return {
      ...state,
      ...appendRunFrames({ run: state, eventId: event.id, frames }),
      ...(keepsResult ? { resultFrames: { ...state.resultFrames, [resultKey]: result } } : {}),
    };
  }
}
