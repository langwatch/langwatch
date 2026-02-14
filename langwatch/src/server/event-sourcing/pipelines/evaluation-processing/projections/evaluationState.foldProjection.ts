import type { Projection } from "../../../library";
import type { FoldProjectionDefinition } from "../../../library/projections/foldProjection.types";
import { EVALUATION_PROCESSING_EVENT_TYPES } from "../schemas/constants";
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
 * Intermediate fold state for computing evaluation state from lifecycle events.
 *
 * Tracks the evaluation's progression through scheduled -> in_progress -> completed states.
 */
export interface EvaluationStateFoldState {
  evaluationId: string;
  evaluatorId: string;
  evaluatorType: string;
  evaluatorName: string | null;
  traceId: string | null;
  isGuardrail: boolean;
  status: "scheduled" | "in_progress" | "processed" | "error" | "skipped";
  score: number | null;
  passed: boolean | null;
  label: string | null;
  details: string | null;
  error: string | null;
  scheduledAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  firstEventTimestamp: number | null;
}

/**
 * FoldProjection definition for evaluation state.
 *
 * Extracts the init/apply logic from EvaluationStateProjectionHandler.handle()
 * into a pure functional fold. Events are applied in order:
 * - EvaluationScheduledEvent -> status: "scheduled"
 * - EvaluationStartedEvent -> status: "in_progress"
 * - EvaluationCompletedEvent -> status: "processed" | "error" | "skipped"
 */
export const evaluationStateFoldProjection: FoldProjectionDefinition<
  EvaluationStateFoldState,
  EvaluationProcessingEvent
> = {
  name: "evaluationState",
  eventTypes: EVALUATION_PROCESSING_EVENT_TYPES,

  init(): EvaluationStateFoldState {
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
      firstEventTimestamp: null,
    };
  },

  apply(
    state: EvaluationStateFoldState,
    event: EvaluationProcessingEvent,
  ): EvaluationStateFoldState {
    // Track the first event timestamp for deterministic ID generation
    const firstEventTimestamp = state.firstEventTimestamp ?? event.timestamp;

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
        scheduledAt: event.timestamp,
        firstEventTimestamp,
      };
    }

    if (isEvaluationStartedEvent(event)) {
      return {
        ...state,
        // Merge metadata fields individually to allow backfilling from start event
        // when schedule event had partial or missing data
        evaluatorId: state.evaluatorId || event.data.evaluatorId,
        evaluatorType: state.evaluatorType || event.data.evaluatorType,
        evaluatorName: state.evaluatorName ?? (event.data.evaluatorName ?? null),
        traceId: state.traceId ?? (event.data.traceId ?? null),
        isGuardrail: event.data.isGuardrail ?? state.isGuardrail,
        status: "in_progress",
        startedAt: event.timestamp,
        firstEventTimestamp,
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
        completedAt: event.timestamp,
        firstEventTimestamp,
      };
    }

    return { ...state, firstEventTimestamp };
  },

  store: evaluationStateFoldStore,
};
