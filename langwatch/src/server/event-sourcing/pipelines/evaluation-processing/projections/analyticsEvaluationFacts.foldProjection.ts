import type { AnalyticsEvaluationFactData } from "~/server/app-layer/analytics/types";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
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

export type { AnalyticsEvaluationFactData };

const analyticsEvaluationFactEvents = [
  evaluationScheduledEventSchema,
  evaluationStartedEventSchema,
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
] as const;

/**
 * Fold projection that populates the denormalized analytics_evaluation_facts table.
 *
 * Mirrors the EvaluationRunFoldProjection logic but maps to the flatter analytics
 * schema with best-effort trace context fields.
 *
 * - `implements FoldEventHandlers` enforces a handler exists for every event schema
 * - Handler names derived from event type strings
 * - `updatedAt` is auto-managed by the base class after each handler call (camelCase)
 */
export class AnalyticsEvaluationFactsFoldProjection
  extends AbstractFoldProjection<
    AnalyticsEvaluationFactData,
    typeof analyticsEvaluationFactEvents
  >
  implements
    FoldEventHandlers<
      typeof analyticsEvaluationFactEvents,
      AnalyticsEvaluationFactData
    >
{
  readonly name = "analyticsEvaluationFacts";
  readonly version = "2026-04-01";
  readonly store: FoldProjectionStore<AnalyticsEvaluationFactData>;
  protected override readonly timestampStyle = "camel" as const;

  protected readonly events = analyticsEvaluationFactEvents;

  constructor(deps: {
    store: FoldProjectionStore<AnalyticsEvaluationFactData>;
  }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return {
      evaluationId: "",
      traceId: null as string | null,
      occurredAt: 0,

      // Evaluator
      evaluatorId: "",
      evaluatorName: null as string | null,
      evaluatorType: "",
      isGuardrail: false,

      // Results
      score: null as number | null,
      passed: null as boolean | null,
      label: null as string | null,
      status: "scheduled" as string,

      // Best-effort trace context
      userId: null as string | null,
      threadId: null as string | null,
      topicId: null as string | null,
      customerId: null as string | null,
    };
  }

  handleEvaluationScheduled(
    event: EvaluationScheduledEvent,
    state: AnalyticsEvaluationFactData,
  ): AnalyticsEvaluationFactData {
    return {
      ...state,
      evaluationId: event.data.evaluationId,
      evaluatorId: event.data.evaluatorId,
      evaluatorType: event.data.evaluatorType,
      evaluatorName: event.data.evaluatorName ?? null,
      traceId: event.data.traceId ?? null,
      isGuardrail: event.data.isGuardrail ?? false,
      status: "scheduled",
      occurredAt: event.occurredAt,
    };
  }

  handleEvaluationStarted(
    event: EvaluationStartedEvent,
    state: AnalyticsEvaluationFactData,
  ): AnalyticsEvaluationFactData {
    return {
      ...state,
      evaluationId: state.evaluationId || event.data.evaluationId,
      evaluatorId: state.evaluatorId || event.data.evaluatorId,
      evaluatorType: state.evaluatorType || event.data.evaluatorType,
      evaluatorName: state.evaluatorName ?? (event.data.evaluatorName ?? null),
      traceId: state.traceId ?? (event.data.traceId ?? null),
      isGuardrail: event.data.isGuardrail ?? state.isGuardrail,
      status: "in_progress",
    };
  }

  handleEvaluationCompleted(
    event: EvaluationCompletedEvent,
    state: AnalyticsEvaluationFactData,
  ): AnalyticsEvaluationFactData {
    return {
      ...state,
      evaluationId: state.evaluationId || event.data.evaluationId,
      status: event.data.status,
      score: typeof event.data.score === "number" ? event.data.score : null,
      passed: event.data.passed ?? null,
      label: event.data.label ?? null,
    };
  }

  handleEvaluationReported(
    event: EvaluationReportedEvent,
    state: AnalyticsEvaluationFactData,
  ): AnalyticsEvaluationFactData {
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
      occurredAt: state.occurredAt || event.occurredAt,
    };
  }
}
