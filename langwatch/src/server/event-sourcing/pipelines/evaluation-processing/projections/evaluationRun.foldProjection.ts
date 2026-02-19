import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { Projection } from "../../../";
import type { FoldProjectionDefinition, FoldProjectionStore } from "../../../projections/foldProjection.types";
import { EVALUATION_PROCESSING_EVENT_TYPES, EVALUATION_PROJECTION_VERSIONS } from "../schemas/constants";
import type { EvaluationProcessingEvent } from "../schemas/events";
import {
  isEvaluationCompletedEvent,
  isEvaluationScheduledEvent,
  isEvaluationStartedEvent,
} from "../schemas/events";

export type { EvaluationRunData };

/**
 * Projection for evaluation run.
 */
export interface EvaluationRun extends Projection<EvaluationRunData> {
  data: EvaluationRunData;
}

/**
 * Creates a FoldProjection definition for evaluation run.
 *
 * Fold state = stored data. `apply()` writes camelCase fields directly.
 * Events are applied in order:
 * - EvaluationScheduledEvent -> status: "scheduled"
 * - EvaluationStartedEvent -> status: "in_progress"
 * - EvaluationCompletedEvent -> status: "processed" | "error" | "skipped"
 */
export function createEvaluationRunFoldProjection({
  store,
}: {
  store: FoldProjectionStore<EvaluationRunData>;
}): FoldProjectionDefinition<EvaluationRunData, EvaluationProcessingEvent> {
  return {
    name: "evaluationRun",
    version: EVALUATION_PROJECTION_VERSIONS.STATE,
    eventTypes: EVALUATION_PROCESSING_EVENT_TYPES,

    init(): EvaluationRunData {
      return {
        evaluationId: "",
        evaluatorId: "",
        evaluatorType: "",
        evaluatorName: null,
        traceId: null,
        isGuardrail: false,
        status: "scheduled",
        score: null,
        passed: null,
        label: null,
        details: null,
        error: null,
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
        costId: null,
      };
    },

    apply(
      state: EvaluationRunData,
      event: EvaluationProcessingEvent,
    ): EvaluationRunData {
      if (isEvaluationScheduledEvent(event)) {
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

      if (isEvaluationStartedEvent(event)) {
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

      if (isEvaluationCompletedEvent(event)) {
        return {
          ...state,
          status: event.data.status,
          score: event.data.score ?? null,
          passed: event.data.passed ?? null,
          label: event.data.label ?? null,
          details: event.data.details ?? null,
          error: event.data.error ?? null,
          completedAt: event.occurredAt,
          costId: event.data.costId ?? null,
        };
      }

      return state;
    },

    store,
  };
}
