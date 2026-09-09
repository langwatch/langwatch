import type { FoldProjectionStore, Projection } from "@langwatch/eventing";
import { AbstractFoldProjection, type FoldEventHandlers } from "@langwatch/eventing";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { EVALUATION_PROJECTION_VERSIONS } from "@langwatch/evaluation-contract";
import type {
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
} from "@langwatch/evaluation-contract";
import {
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
  evaluationScheduledEventSchema,
  evaluationStartedEventSchema,
} from "@langwatch/evaluation-contract";
import { verdictPassedOf, verdictScoreOf } from "@langwatch/evaluation-contract";

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
  extends AbstractFoldProjection<
    EvaluationRunData,
    typeof evaluationRunEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements FoldEventHandlers<typeof evaluationRunEvents, EvaluationRunData>
{
  static create(deps: {
    store: FoldProjectionStore<EvaluationRunData>;
  }): EvaluationRunFoldProjection {
    return new EvaluationRunFoldProjection(deps);
  }

  readonly name = "evaluationRun";
  readonly version = EVALUATION_PROJECTION_VERSIONS.STATE;
  readonly store: FoldProjectionStore<EvaluationRunData>;
  readonly options = { eventOrdering: "acceptedAt" } as const;

  protected readonly events = evaluationRunEvents;

  constructor(deps: { store: FoldProjectionStore<EvaluationRunData> }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
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
      evaluatorName: state.evaluatorName ?? event.data.evaluatorName ?? null,
      traceId: state.traceId ?? event.data.traceId ?? null,
      isGuardrail: event.data.isGuardrail ?? state.isGuardrail,
      status: "in_progress",
      startedAt: event.occurredAt,
    };
  }

  handleEvaluationCompleted(
    event: EvaluationCompletedEvent,
    state: EvaluationRunData,
  ): EvaluationRunData {
    return {
      ...state,
      evaluationId: state.evaluationId || event.data.evaluationId,
      status: event.data.status,
      // Verdicts are gated on status === "processed" (#6833) — shared with
      // the slim fold so the documented slim<->runs parity holds.
      score: verdictScoreOf(event.data),
      passed: verdictPassedOf(event.data),
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
      // Verdicts are gated on status === "processed" (#6833) — shared with
      // the slim fold so the documented slim<->runs parity holds.
      score: verdictScoreOf(event.data),
      passed: verdictPassedOf(event.data),
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
