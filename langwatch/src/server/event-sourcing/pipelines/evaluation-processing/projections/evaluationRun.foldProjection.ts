import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { Projection } from "../../../";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import { EVALUATION_PROJECTION_VERSIONS } from "../schemas/constants";
import type {
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
} from "../schemas/events";
import {
  evaluationScheduledEventSchema,
  evaluationStartedEventSchema,
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
} from "../schemas/events";

export type { EvaluationRunData };

/**
 * Projection for evaluation run.
 */
export interface EvaluationRun extends Projection<EvaluationRunData> {
  data: EvaluationRunData;
}

const evaluationRunEvents = [
  evaluationScheduledEventSchema,
  evaluationStartedEventSchema,
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
] as const;

/**
 * Type-safe fold projection for evaluation run state.
 *
 * - `implements FoldEventHandlers` enforces a handler exists for every event schema
 * - Handler names derived from event type strings (e.g. `"lw.evaluation.scheduled"` -> `handleEvaluationScheduled`)
 * - `updatedAt` is auto-managed by the base class after each handler call (camelCase)
 *
 * Events are applied in order:
 * - EvaluationScheduledEvent -> status: "scheduled"
 * - EvaluationStartedEvent -> status: "in_progress"
 * - EvaluationCompletedEvent -> status: "processed" | "error" | "skipped"
 * - EvaluationReportedEvent -> sets all fields in one shot (evaluator identity + results)
 */
export class EvaluationRunFoldProjection
  extends AbstractFoldProjection<EvaluationRunData, typeof evaluationRunEvents, "createdAt", "updatedAt">
  implements FoldEventHandlers<typeof evaluationRunEvents, EvaluationRunData>
{
  readonly name = "evaluationRun";
  readonly version = EVALUATION_PROJECTION_VERSIONS.STATE;
  readonly store: FoldProjectionStore<EvaluationRunData>;

  protected readonly events = evaluationRunEvents;

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
