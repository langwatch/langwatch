import { createLogger } from "../../../../../utils/logger";
import type {
  EventStream,
  Projection,
  ProjectionHandler,
} from "../../../library";
import { getBatchEvaluationRunStateRepository } from "../repositories";
import { BATCH_EVALUATION_RUN_STATE_PROJECTION_VERSION_LATEST } from "../schemas/constants";
import type { BatchEvaluationProcessingEvent } from "../schemas/events";
import {
  isBatchEvaluationCompletedEvent,
  isBatchEvaluationStartedEvent,
  isEvaluatorResultReceivedEvent,
  isTargetResultReceivedEvent,
} from "../schemas/events";

const logger = createLogger(
  "langwatch:batch-evaluation-processing:run-state-projection",
);

/**
 * Target configuration stored in the projection.
 * Matches ESBatchEvaluationTarget type from ~/server/experiments/types.
 */
export interface BatchEvaluationTarget {
  id: string;
  name: string;
  type: string;
  prompt_id?: string | null;
  prompt_version?: number | null;
  agent_id?: string | null;
  model?: string | null;
  metadata?: Record<string, string | number | boolean> | null;
}

/**
 * State data for a batch evaluation run.
 * Matches the batch_evaluation_runs ClickHouse table schema.
 */
export interface BatchEvaluationRunStateData {
  RunId: string;
  ExperimentId: string;
  WorkflowVersionId: string | null;
  Total: number;
  Progress: number;
  CompletedCount: number;
  FailedCount: number;
  TotalCost: number | null;
  TotalDurationMs: number | null;
  AvgScore: number | null;
  PassRate: number | null;
  Targets: string; // JSON array
  CreatedAt: number;
  UpdatedAt: number;
  FinishedAt: number | null;
  StoppedAt: number | null;
}

/**
 * Projection for batch evaluation run state.
 */
export interface BatchEvaluationRunState
  extends Projection<BatchEvaluationRunStateData> {
  data: BatchEvaluationRunStateData;
}

/**
 * Projection handler that computes batch evaluation run state from events.
 *
 * Processes events in order:
 * - BatchEvaluationStartedEvent -> Initialize run with targets and total
 * - TargetResultReceivedEvent -> Track progress, costs, durations, errors
 * - EvaluatorResultReceivedEvent -> Track scores and pass/fail
 * - BatchEvaluationCompletedEvent -> Mark as finished or stopped
 */
export class BatchEvaluationRunStateProjectionHandler
  implements
    ProjectionHandler<BatchEvaluationProcessingEvent, BatchEvaluationRunState>
{
  static get store() {
    return getBatchEvaluationRunStateRepository();
  }

  handle(
    stream: EventStream<
      BatchEvaluationProcessingEvent["tenantId"],
      BatchEvaluationProcessingEvent
    >,
  ): BatchEvaluationRunState {
    const events = stream.getEvents();
    const aggregateId = stream.getAggregateId();
    const tenantId = stream.getTenantId();

    // Initialize state
    let runId = aggregateId;
    let experimentId = "";
    let workflowVersionId: string | null = null;
    let total = 0;
    let targets: BatchEvaluationTarget[] = [];
    let createdAt = 0;
    let updatedAt = 0;
    let finishedAt: number | null = null;
    let stoppedAt: number | null = null;

    // Track unique completed cells (by rowIndex + targetId)
    const completedCells = new Set<string>();
    const failedCells = new Set<string>();

    // Track costs and durations from target results
    let totalCost = 0;
    let totalDurationMs = 0;
    let hasCostData = false;
    let hasDurationData = false;

    // Track scores from evaluator results
    const scores: number[] = [];
    let passedCount = 0;
    let evaluatorResultCount = 0;

    // Process events in order to build current state
    for (const event of events) {
      if (isBatchEvaluationStartedEvent(event)) {
        runId = event.data.runId;
        experimentId = event.data.experimentId;
        workflowVersionId = event.data.workflowVersionId ?? null;
        total = event.data.total;
        targets = event.data.targets;
        createdAt = event.timestamp;
        updatedAt = event.timestamp;

        logger.debug(
          { runId, experimentId, total },
          "Processing BatchEvaluationStartedEvent",
        );
      } else if (isTargetResultReceivedEvent(event)) {
        const cellKey = `${event.data.index}:${event.data.targetId}`;

        if (event.data.error) {
          failedCells.add(cellKey);
        } else {
          completedCells.add(cellKey);
        }

        if (event.data.cost !== undefined && event.data.cost !== null) {
          totalCost += event.data.cost;
          hasCostData = true;
        }

        if (event.data.duration !== undefined && event.data.duration !== null) {
          totalDurationMs += event.data.duration;
          hasDurationData = true;
        }

        updatedAt = event.timestamp;

        logger.debug(
          {
            runId: event.data.runId,
            index: event.data.index,
            targetId: event.data.targetId,
          },
          "Processing TargetResultReceivedEvent",
        );
      } else if (isEvaluatorResultReceivedEvent(event)) {
        evaluatorResultCount++;

        if (
          event.data.status === "processed" &&
          event.data.score !== undefined &&
          event.data.score !== null
        ) {
          scores.push(event.data.score);
        }

        if (
          event.data.status === "processed" &&
          event.data.passed !== undefined &&
          event.data.passed !== null
        ) {
          if (event.data.passed) {
            passedCount++;
          }
        }

        // Also track cost from evaluator results
        if (event.data.cost !== undefined && event.data.cost !== null) {
          totalCost += event.data.cost;
          hasCostData = true;
        }

        updatedAt = event.timestamp;

        logger.debug(
          {
            runId: event.data.runId,
            index: event.data.index,
            evaluatorId: event.data.evaluatorId,
            status: event.data.status,
          },
          "Processing EvaluatorResultReceivedEvent",
        );
      } else if (isBatchEvaluationCompletedEvent(event)) {
        finishedAt = event.data.finishedAt ?? null;
        stoppedAt = event.data.stoppedAt ?? null;
        updatedAt = event.timestamp;

        logger.debug(
          { runId: event.data.runId, finishedAt, stoppedAt },
          "Processing BatchEvaluationCompletedEvent",
        );
      }
    }

    // Calculate derived metrics
    const progress = completedCells.size + failedCells.size;
    const completedCount = completedCells.size;
    const failedCount = failedCells.size;
    const avgScore =
      scores.length > 0
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length
        : null;
    const passRate =
      evaluatorResultCount > 0 ? passedCount / evaluatorResultCount : null;

    // Generate deterministic projection ID
    const projectionId = `batch_eval_run_state:${tenantId}:${runId}`;

    logger.debug(
      {
        tenantId,
        runId,
        progress,
        completedCount,
        failedCount,
        eventCount: events.length,
      },
      "Computed batch evaluation run state from events",
    );

    return {
      id: projectionId,
      aggregateId,
      tenantId,
      version: BATCH_EVALUATION_RUN_STATE_PROJECTION_VERSION_LATEST,
      data: {
        RunId: runId,
        ExperimentId: experimentId,
        WorkflowVersionId: workflowVersionId,
        Total: total,
        Progress: progress,
        CompletedCount: completedCount,
        FailedCount: failedCount,
        TotalCost: hasCostData ? totalCost : null,
        TotalDurationMs: hasDurationData ? totalDurationMs : null,
        AvgScore: avgScore,
        PassRate: passRate,
        Targets: JSON.stringify(targets),
        CreatedAt: createdAt,
        UpdatedAt: updatedAt,
        FinishedAt: finishedAt,
        StoppedAt: stoppedAt,
      },
    } satisfies BatchEvaluationRunState;
  }
}
