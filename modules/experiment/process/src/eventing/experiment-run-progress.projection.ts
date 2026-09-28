import {
  AbstractFoldProjection,
  type FoldEventHandlers,
  type FoldProjectionStore,
} from "@langwatch/eventing";

import type { ExperimentRunProgressState } from "../repositories/experiment-run-fold.repository.ts";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../rules/experiment-run-event-types.rules.ts";
import { foldEvaluatorsOf, runCellKey } from "../rules/experiment-run-plan.rules.ts";
import { markFinished } from "../rules/experiment-run-window.rules.ts";
import {
  type CellFinishedEvent,
  cellFinishedEventSchema,
  type EvaluatorResultEvent,
  evaluatorResultEventSchema,
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
] as const;

type TimestampKeys = "CreatedAt" | "UpdatedAt" | "LastEventOccurredAt";

/**
 * What a run's cells read as it goes (ARCHITECTURE §9, D2): which cells finished, and each
 * target's output, trace and verdicts per row. Every handler is keyed or idempotent, so a
 * redelivered or out-of-order event folds to the same state.
 */
export class ExperimentRunProgressFoldProjection
  extends AbstractFoldProjection<ExperimentRunProgressState, typeof experimentRunProgressEvents>
  implements FoldEventHandlers<typeof experimentRunProgressEvents, ExperimentRunProgressState>
{
  readonly name = "experimentRunProgress";
  readonly version = EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_PROGRESS;
  readonly store: FoldProjectionStore<ExperimentRunProgressState>;
  readonly options = { refoldOnOutOfOrder: false } as const;

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
    };
  }

  handleExperimentRunStarted(
    event: ExperimentRunStartedEvent,
    state: ExperimentRunProgressState,
  ): ExperimentRunProgressState {
    const plan = event.data.plan;
    return {
      ...state,
      projectId: String(event.tenantId),
      runId: event.data.runId,
      experimentId: event.data.experimentId,
      planned: plan !== undefined,
      phaseOneCells: plan?.cells.filter((cell) => cell.phase === 1).length ?? 0,
      evaluators: plan ? foldEvaluatorsOf(plan) : {},
    };
  }

  /** A produced output is kept for the comparisons; a carried board cell is not. */
  handleExperimentRunTargetResult(
    event: TargetResultEvent,
    state: ExperimentRunProgressState,
  ): ExperimentRunProgressState {
    const { data } = event;
    if (data.carriedOver) return state;

    const key = runCellKey({ rowIndex: data.index, targetId: data.targetId });
    const traceIds = data.traceId ? { ...state.traceIds, [key]: data.traceId } : state.traceIds;
    const output = data.predicted?.output;
    if (data.error || output === null || output === undefined) {
      return { ...state, traceIds };
    }

    return {
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
    };
  }

  /** A scored verdict, named as main named it; a comparison's own verdict is never kept. */
  handleExperimentRunEvaluatorResult(
    event: EvaluatorResultEvent,
    state: ExperimentRunProgressState,
  ): ExperimentRunProgressState {
    const { data } = event;
    const evaluator = state.evaluators[data.evaluatorId];
    if (data.carriedOver || data.status !== "processed" || !evaluator || evaluator.comparison) {
      return state;
    }

    const key = runCellKey({ rowIndex: data.index, targetId: data.targetId });
    const name = (evaluator.recordNamed ? data.evaluatorName : undefined) ?? evaluator.fallbackName;
    return {
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
    };
  }

  handleExperimentRunCellFinished(
    event: CellFinishedEvent,
    state: ExperimentRunProgressState,
  ): ExperimentRunProgressState {
    return {
      ...state,
      finishedCells: markFinished({ bitmap: state.finishedCells, ordinal: event.data.ordinal }),
    };
  }
}
