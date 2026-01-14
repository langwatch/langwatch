import { createLogger } from "../../../../../utils/logger";
import type {
  EventStream,
  Projection,
  ProjectionHandler,
} from "../../../library";
import { evaluationStateRepository } from "../repositories";
import type { EvaluationProcessingEvent } from "../schemas/events";
import {
  isEvaluationScheduledEvent,
  isEvaluationStartedEvent,
  isEvaluationCompletedEvent,
} from "../schemas/events";
import { EVALUATION_STATE_PROJECTION_VERSION_LATEST } from "../schemas/constants";

const logger = createLogger(
  "langwatch:evaluation-processing:evaluation-state-projection"
);

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

  // Current state
  Status: "scheduled" | "in_progress" | "processed" | "error" | "skipped";

  // Result (only for completed evaluations)
  Score: number | null;
  Passed: boolean | null;
  Label: string | null;
  Details: string | null;
  Error: string | null;

  // Timestamps
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
 * Projection handler that computes evaluation state from lifecycle events.
 *
 * Processes events in order:
 * - EvaluationScheduledEvent -> status: "scheduled"
 * - EvaluationStartedEvent -> status: "in_progress"
 * - EvaluationCompletedEvent -> status: "processed" | "error" | "skipped"
 */
export class EvaluationStateProjectionHandler
  implements ProjectionHandler<EvaluationProcessingEvent, EvaluationState>
{
  static readonly store = evaluationStateRepository;

  handle(
    stream: EventStream<
      EvaluationProcessingEvent["tenantId"],
      EvaluationProcessingEvent
    >
  ): EvaluationState {
    const events = stream.getEvents();
    const aggregateId = stream.getAggregateId();
    const tenantId = stream.getTenantId();

    // Initialize state
    let evaluationId = aggregateId;
    let evaluatorId = "";
    let evaluatorType = "";
    let evaluatorName: string | null = null;
    let traceId: string | null = null;
    let isGuardrail = false;
    let status: EvaluationStateData["Status"] = "scheduled";
    let score: number | null = null;
    let passed: boolean | null = null;
    let label: string | null = null;
    let details: string | null = null;
    let error: string | null = null;
    let scheduledAt: number | null = null;
    let startedAt: number | null = null;
    let completedAt: number | null = null;

    // Process events in order to build current state
    for (const event of events) {
      if (isEvaluationScheduledEvent(event)) {
        evaluationId = event.data.evaluationId;
        evaluatorId = event.data.evaluatorId;
        evaluatorType = event.data.evaluatorType;
        evaluatorName = event.data.evaluatorName ?? null;
        traceId = event.data.traceId ?? null;
        isGuardrail = event.data.isGuardrail ?? false;
        status = "scheduled";
        scheduledAt = event.timestamp;

        logger.debug(
          { evaluationId, evaluatorType, traceId },
          "Processing EvaluationScheduledEvent"
        );
      } else if (isEvaluationStartedEvent(event)) {
        // Update evaluator info if not set (for direct API calls without scheduling)
        if (!evaluatorId) {
          evaluatorId = event.data.evaluatorId;
          evaluatorType = event.data.evaluatorType;
          evaluatorName = event.data.evaluatorName ?? null;
          traceId = event.data.traceId ?? null;
          isGuardrail = event.data.isGuardrail ?? false;
        }
        status = "in_progress";
        startedAt = event.timestamp;

        logger.debug(
          { evaluationId, evaluatorType },
          "Processing EvaluationStartedEvent"
        );
      } else if (isEvaluationCompletedEvent(event)) {
        status = event.data.status;
        score = event.data.score ?? null;
        passed = event.data.passed ?? null;
        label = event.data.label ?? null;
        details = event.data.details ?? null;
        error = event.data.error ?? null;
        completedAt = event.timestamp;

        logger.debug(
          { evaluationId, status, score, passed },
          "Processing EvaluationCompletedEvent"
        );
      }
    }

    // Generate deterministic projection ID
    const projectionId = `eval_state:${tenantId}:${evaluationId}`;

    logger.debug(
      {
        tenantId,
        evaluationId,
        status,
        eventCount: events.length,
      },
      "Computed evaluation state from events"
    );

    return {
      id: projectionId,
      aggregateId,
      tenantId,
      version: EVALUATION_STATE_PROJECTION_VERSION_LATEST,
      data: {
        EvaluationId: evaluationId,
        EvaluatorId: evaluatorId,
        EvaluatorType: evaluatorType,
        EvaluatorName: evaluatorName,
        TraceId: traceId,
        IsGuardrail: isGuardrail,
        Status: status,
        Score: score,
        Passed: passed,
        Label: label,
        Details: details,
        Error: error,
        ScheduledAt: scheduledAt,
        StartedAt: startedAt,
        CompletedAt: completedAt,
      },
    } satisfies EvaluationState;
  }
}
