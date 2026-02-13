import { createLogger } from "../../../../../utils/logger/server";
import type {
  EventStream,
  Projection,
  ProjectionHandler,
} from "../../../library";
import { getExperimentRunStateRepository } from "../repositories";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../schemas/constants";
import type { ExperimentRunProcessingEvent } from "../schemas/events";
import {
  isExperimentRunCompletedEvent,
  isExperimentRunStartedEvent,
  isEvaluatorResultEvent,
  isTargetResultEvent,
} from "../schemas/events";
import type { ExperimentRunTarget } from "../schemas/shared";

const logger = createLogger(
  "langwatch:experiment-run-processing:run-state-projection",
);

export interface ExperimentRunStateData {
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
  Targets: string;
  CreatedAt: number;
  UpdatedAt: number;
  FinishedAt: number | null;
  StoppedAt: number | null;
}

export interface ExperimentRunState extends Projection<ExperimentRunStateData> {
  data: ExperimentRunStateData;
}

export class ExperimentRunStateProjectionHandler
  implements
    ProjectionHandler<ExperimentRunProcessingEvent, ExperimentRunState>
{
  static get store() {
    return getExperimentRunStateRepository();
  }

  handle(
    stream: EventStream<
      ExperimentRunProcessingEvent["tenantId"],
      ExperimentRunProcessingEvent
    >,
  ): ExperimentRunState {
    const events = stream.getEvents();
    const aggregateId = stream.getAggregateId();
    const tenantId = stream.getTenantId();

    let runId = aggregateId;
    let experimentId = "";
    let workflowVersionId: string | null = null;
    let total = 0;
    let targets: ExperimentRunTarget[] = [];
    let createdAt = 0;
    let updatedAt = 0;
    let finishedAt: number | null = null;
    let stoppedAt: number | null = null;

    const completedCells = new Set<string>();
    const failedCells = new Set<string>();

    let totalCost = 0;
    let totalDurationMs = 0;
    let hasCostData = false;
    let hasDurationData = false;

    const scores: number[] = [];
    let passedCount = 0;
    let passFailCount = 0;

    for (const event of events) {
      if (isExperimentRunStartedEvent(event)) {
        runId = event.data.runId;
        experimentId = event.data.experimentId;
        workflowVersionId = event.data.workflowVersionId ?? null;
        total = event.data.total;
        targets = event.data.targets;
        createdAt = event.timestamp;
        updatedAt = event.timestamp;
        logger.debug({ runId, experimentId, total }, "Processing ExperimentRunStartedEvent");
      } else if (isTargetResultEvent(event)) {
        const cellKey = `${event.data.index}:${event.data.targetId}`;
        if (event.data.error) {
          failedCells.add(cellKey);
          completedCells.delete(cellKey);
        } else {
          completedCells.add(cellKey);
          failedCells.delete(cellKey);
        }
        if (event.data.cost != null) {
          totalCost += event.data.cost;
          hasCostData = true;
        }
        if (event.data.duration != null) {
          totalDurationMs += event.data.duration;
          hasDurationData = true;
        }
        updatedAt = event.timestamp;
        logger.debug({ runId: event.data.runId, index: event.data.index, targetId: event.data.targetId },
          "Processing TargetResultEvent");
      } else if (isEvaluatorResultEvent(event)) {
        if (event.data.status === "processed") {
          if (event.data.score != null) {
            scores.push(event.data.score);
          }
          if (event.data.passed != null) {
            passFailCount++;
            if (event.data.passed) passedCount++;
          }
        }
        if (event.data.cost != null) {
          totalCost += event.data.cost;
          hasCostData = true;
        }
        updatedAt = event.timestamp;
        logger.debug({ runId: event.data.runId, index: event.data.index, evaluatorId: event.data.evaluatorId, status: event.data.status },
          "Processing EvaluatorResultEvent");
      } else if (isExperimentRunCompletedEvent(event)) {
        finishedAt = event.data.finishedAt ?? null;
        stoppedAt = event.data.stoppedAt ?? null;
        updatedAt = event.timestamp;
        logger.debug({ runId: event.data.runId, finishedAt, stoppedAt }, "Processing ExperimentRunCompletedEvent");
      }
    }

    const progress = completedCells.size + failedCells.size;
    const completedCount = completedCells.size;
    const failedCount = failedCells.size;
    const avgScore = scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : null;
    const passRate = passFailCount > 0 ? passedCount / passFailCount : null;

    const projectionId = `experiment_run_state:${tenantId}:${runId}`;

    logger.debug({ tenantId, runId, progress, completedCount, failedCount, eventCount: events.length },
      "Computed experiment run state from events");

    return {
      id: projectionId,
      aggregateId,
      tenantId,
      version: EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,
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
    } satisfies ExperimentRunState;
  }
}
