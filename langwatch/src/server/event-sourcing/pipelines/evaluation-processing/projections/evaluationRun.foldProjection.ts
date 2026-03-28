import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { Projection } from "../../../";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import {
  EVALUATION_EVENT_TYPES,
  EVALUATION_PROJECTION_VERSIONS,
} from "../schemas/constants";
import type {
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
} from "../schemas/events";

export type { EvaluationRunData };

/**
 * Projection for evaluation run.
 */
export interface EvaluationRun extends Projection<EvaluationRunData> {
  data: EvaluationRunData;
}

/**
 * Event map — single source of truth for which events this projection handles.
 * Keys become handler method names: `handle${Key}`.
 */
type EvaluationRunEventMap = {
  EvaluationScheduled: EvaluationScheduledEvent;
  EvaluationStarted: EvaluationStartedEvent;
  EvaluationCompleted: EvaluationCompletedEvent;
  EvaluationReported: EvaluationReportedEvent;
};

/**
 * Type-safe fold projection for evaluation run state.
 *
 * - `implements FoldEventHandlers` enforces a handler exists for every event in the map
 * - `eventTypeMap` routes runtime event.type strings to the correct handler
 * - `updatedAt` is auto-managed by the base class after each handler call (camelCase)
 *
 * Events are applied in order:
 * - EvaluationScheduledEvent -> status: "scheduled"
 * - EvaluationStartedEvent -> status: "in_progress"
 * - EvaluationCompletedEvent -> status: "processed" | "error" | "skipped"
 * - EvaluationReportedEvent -> sets all fields in one shot (evaluator identity + results)
 */
export class EvaluationRunFoldProjection
  extends AbstractFoldProjection<EvaluationRunData, EvaluationRunEventMap, "createdAt", "updatedAt">
  implements FoldEventHandlers<EvaluationRunEventMap, EvaluationRunData>
{
  readonly name = "evaluationRun";
  readonly version = EVALUATION_PROJECTION_VERSIONS.STATE;
  readonly store: FoldProjectionStore<EvaluationRunData>;

  protected readonly eventTypeMap = {
    [EVALUATION_EVENT_TYPES.SCHEDULED]: "handleEvaluationScheduled",
    [EVALUATION_EVENT_TYPES.STARTED]: "handleEvaluationStarted",
    [EVALUATION_EVENT_TYPES.COMPLETED]: "handleEvaluationCompleted",
    [EVALUATION_EVENT_TYPES.REPORTED]: "handleEvaluationReported",
  } as const;

  constructor(deps: { store: FoldProjectionStore<EvaluationRunData> }) {
    super({ createdAtKey: "createdAt", updatedAtKey: "updatedAt" });
    this.store = deps.store;
  }

  protected initState() {
    return {
      evaluationId: "",
      evaluatorId: "",
      evaluatorType: "",
      evaluatorName: null,
      traceId: null,
      isGuardrail: false,
      status: "scheduled" as const,
      score: null,
      passed: null,
      label: null,
      details: null,
      inputs: null,
      error: null,
      errorDetails: null,
      archivedAt: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      costId: null,
    };
  }

  handleEvaluationScheduled(
    event: EvaluationScheduledEvent,
    state: EvaluationRunData,
  ): EvaluationRunData {
    return {
      ...state,
      evaluationId: event.data.evaluationId,
      evaluatorId: event.data.evaluatorId,
      evaluatorType: event.data.evaluatorType,
      evaluatorName: event.data.evaluatorName ?? null,
      traceId: event.data.traceId ?? null,
      isGuardrail: event.data.isGuardrail ?? false,
      status: "scheduled",
      scheduledAt: event.occurredAt,
    };
  }

  handleEvaluationStarted(
    event: EvaluationStartedEvent,
    state: EvaluationRunData,
  ): EvaluationRunData {
    return {
      ...state,
      evaluationId: state.evaluationId || event.data.evaluationId,
      evaluatorId: state.evaluatorId || event.data.evaluatorId,
      evaluatorType: state.evaluatorType || event.data.evaluatorType,
      evaluatorName: state.evaluatorName ?? (event.data.evaluatorName ?? null),
      traceId: state.traceId ?? (event.data.traceId ?? null),
      isGuardrail: event.data.isGuardrail ?? state.isGuardrail,
      status: "in_progress",
      startedAt: event.occurredAt,
    };
  }

  handleEvaluationCompleted(
    event: EvaluationCompletedEvent,
    state: EvaluationRunData,
  ): EvaluationRunData {
    if (!state.evaluationId) {
      throw new Error(
        `Received EvaluationCompletedEvent for evaluation ${event.data.evaluationId} but state has no evaluationId — likely a replica lag issue, retrying`,
      );
    }
    return {
      ...state,
      status: event.data.status,
      score: typeof event.data.score === 'number' ? event.data.score : null,
      passed: event.data.passed ?? null,
      label: event.data.label ?? null,
      details: event.data.details ?? null,
      inputs: event.data.inputs ?? null,
      error: event.data.error ?? null,
      errorDetails: event.data.errorDetails ?? null,
      completedAt: event.occurredAt,
      costId: event.data.costId ?? null,
    };
  }

  handleEvaluationReported(
    event: EvaluationReportedEvent,
    state: EvaluationRunData,
  ): EvaluationRunData {
    return {
      ...state,
      evaluationId: event.data.evaluationId,
      evaluatorId: event.data.evaluatorId,
      evaluatorType: event.data.evaluatorType,
      evaluatorName: event.data.evaluatorName ?? null,
      traceId: event.data.traceId ?? null,
      isGuardrail: event.data.isGuardrail ?? false,
      status: event.data.status,
      score: typeof event.data.score === "number" ? event.data.score : null,
      passed: event.data.passed ?? null,
      label: event.data.label ?? null,
      details: event.data.details ?? null,
      inputs: event.data.inputs ?? null,
      error: event.data.error ?? null,
      errorDetails: event.data.errorDetails ?? null,
      costId: event.data.costId ?? null,
      startedAt: event.occurredAt,
      completedAt: event.occurredAt,
    };
  }
}
