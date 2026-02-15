import type { Projection } from "../../../library";
import type { FoldProjectionDefinition } from "../../../library/projections/foldProjection.types";
import { EVALUATION_PROCESSING_EVENT_TYPES, EVALUATION_PROJECTION_VERSIONS } from "../schemas/constants";
import type { EvaluationProcessingEvent } from "../schemas/events";
import {
  isEvaluationCompletedEvent,
  isEvaluationScheduledEvent,
  isEvaluationStartedEvent,
} from "../schemas/events";
import { evaluationStateFoldStore } from "../repositories/evaluationStateFoldStore";

/**
 * State data for an evaluation.
 * Matches the evaluation_states ClickHouse table schema.
 *
 * This is both the fold state and the stored data — one type, not two.
 * `apply()` does all computation. Store is a dumb read/write layer.
 */
export interface EvaluationStateData {
  EvaluationId: string;
  EvaluatorId: string;
  EvaluatorType: string;
  EvaluatorName: string | null;
  TraceId: string | null;
  IsGuardrail: boolean;
  Status: "scheduled" | "in_progress" | "processed" | "error" | "skipped";
  Score: number | null;
  Passed: boolean | null;
  Label: string | null;
  Details: string | null;
  Error: string | null;
  ScheduledAt: number | null;
  StartedAt: number | null;
  CompletedAt: number | null;
}

/**
 * Projection for evaluation state.
 */
export interface EvaluationState extends Projection<EvaluationStateData> {
  data: EvaluationStateData;
}

/**
 * FoldProjection definition for evaluation state.
 *
 * Fold state = stored data. `apply()` writes PascalCase fields directly.
 * Events are applied in order:
 * - EvaluationScheduledEvent -> status: "scheduled"
 * - EvaluationStartedEvent -> status: "in_progress"
 * - EvaluationCompletedEvent -> status: "processed" | "error" | "skipped"
 */
export const evaluationStateFoldProjection: FoldProjectionDefinition<
  EvaluationStateData,
  EvaluationProcessingEvent
> = {
  name: "evaluationState",
  version: EVALUATION_PROJECTION_VERSIONS.STATE,
  eventTypes: EVALUATION_PROCESSING_EVENT_TYPES,

  init(): EvaluationStateData {
    return {
      EvaluationId: "",
      EvaluatorId: "",
      EvaluatorType: "",
      EvaluatorName: null,
      TraceId: null,
      IsGuardrail: false,
      Status: "scheduled",
      Score: null,
      Passed: null,
      Label: null,
      Details: null,
      Error: null,
      ScheduledAt: null,
      StartedAt: null,
      CompletedAt: null,
    };
  },

  apply(
    state: EvaluationStateData,
    event: EvaluationProcessingEvent,
  ): EvaluationStateData {
    if (isEvaluationScheduledEvent(event)) {
      return {
        ...state,
        EvaluationId: event.data.evaluationId,
        EvaluatorId: event.data.evaluatorId,
        EvaluatorType: event.data.evaluatorType,
        EvaluatorName: event.data.evaluatorName ?? null,
        TraceId: event.data.traceId ?? null,
        IsGuardrail: event.data.isGuardrail ?? false,
        Status: "scheduled",
        ScheduledAt: event.occurredAt,
      };
    }

    if (isEvaluationStartedEvent(event)) {
      return {
        ...state,
        EvaluatorId: state.EvaluatorId || event.data.evaluatorId,
        EvaluatorType: state.EvaluatorType || event.data.evaluatorType,
        EvaluatorName: state.EvaluatorName ?? (event.data.evaluatorName ?? null),
        TraceId: state.TraceId ?? (event.data.traceId ?? null),
        IsGuardrail: event.data.isGuardrail ?? state.IsGuardrail,
        Status: "in_progress",
        StartedAt: event.occurredAt,
      };
    }

    if (isEvaluationCompletedEvent(event)) {
      return {
        ...state,
        Status: event.data.status,
        Score: event.data.score ?? null,
        Passed: event.data.passed ?? null,
        Label: event.data.label ?? null,
        Details: event.data.details ?? null,
        Error: event.data.error ?? null,
        CompletedAt: event.occurredAt,
      };
    }

    return state;
  },

  store: evaluationStateFoldStore,
};
