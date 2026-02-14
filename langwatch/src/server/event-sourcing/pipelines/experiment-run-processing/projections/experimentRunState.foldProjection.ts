import type { Projection } from "../../../library";
import type { FoldProjectionDefinition } from "../../../library/projections/foldProjection.types";
import { EXPERIMENT_RUN_PROCESSING_EVENT_TYPES } from "../schemas/constants";
import type { ExperimentRunProcessingEvent } from "../schemas/events";
import {
  isExperimentRunCompletedEvent,
  isExperimentRunStartedEvent,
  isEvaluatorResultEvent,
  isTargetResultEvent,
} from "../schemas/events";
import type { ExperimentRunTarget } from "../schemas/shared";
import { experimentRunStateFoldStore } from "../repositories/experimentRunStateFoldStore";

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

/**
 * Intermediate fold state for computing experiment run state from events.
 *
 * Includes both output fields (matching ExperimentRunStateData) and intermediate
 * bookkeeping fields (Sets, arrays) that the apply function needs to progressively
 * compute aggregates one event at a time.
 */
export interface ExperimentRunFoldState {
  // Output fields
  runId: string;
  experimentId: string;
  workflowVersionId: string | null;
  total: number;
  targets: ExperimentRunTarget[];
  totalCost: number;
  totalDurationMs: number;
  hasCostData: boolean;
  hasDurationData: boolean;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  stoppedAt: number | null;

  // Intermediate fields for progressive computation
  completedCells: Set<string>;
  failedCells: Set<string>;
  scores: number[];
  passedCount: number;
  passFailCount: number;
}

/**
 * FoldProjection definition for experiment run state.
 *
 * Extracts the init/apply logic from ExperimentRunStateProjectionHandler.handle()
 * into a pure functional fold. Each event is applied one at a time to produce
 * the next state, enabling incremental processing.
 */
export const experimentRunStateFoldProjection: FoldProjectionDefinition<
  ExperimentRunFoldState,
  ExperimentRunProcessingEvent
> = {
  name: "experimentRunState",
  eventTypes: EXPERIMENT_RUN_PROCESSING_EVENT_TYPES,

  init(): ExperimentRunFoldState {
    return {
      runId: "",
      experimentId: "",
      workflowVersionId: null,
      total: 0,
      targets: [],
      totalCost: 0,
      totalDurationMs: 0,
      hasCostData: false,
      hasDurationData: false,
      createdAt: 0,
      updatedAt: 0,
      finishedAt: null,
      stoppedAt: null,
      completedCells: new Set<string>(),
      failedCells: new Set<string>(),
      scores: [],
      passedCount: 0,
      passFailCount: 0,
    };
  },

  apply(
    state: ExperimentRunFoldState,
    event: ExperimentRunProcessingEvent,
  ): ExperimentRunFoldState {
    if (isExperimentRunStartedEvent(event)) {
      return {
        ...state,
        runId: event.data.runId,
        experimentId: event.data.experimentId,
        workflowVersionId: event.data.workflowVersionId ?? null,
        total: event.data.total,
        targets: event.data.targets,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      };
    }

    if (isTargetResultEvent(event)) {
      const cellKey = `${event.data.index}:${event.data.targetId}`;

      // Clone sets to maintain immutability
      const completedCells = new Set(state.completedCells);
      const failedCells = new Set(state.failedCells);

      if (event.data.error) {
        failedCells.add(cellKey);
        completedCells.delete(cellKey);
      } else {
        completedCells.add(cellKey);
        failedCells.delete(cellKey);
      }

      let { totalCost, hasCostData, totalDurationMs, hasDurationData } = state;

      if (event.data.cost != null) {
        totalCost += event.data.cost;
        hasCostData = true;
      }
      if (event.data.duration != null) {
        totalDurationMs += event.data.duration;
        hasDurationData = true;
      }

      return {
        ...state,
        completedCells,
        failedCells,
        totalCost,
        hasCostData,
        totalDurationMs,
        hasDurationData,
        updatedAt: event.timestamp,
      };
    }

    if (isEvaluatorResultEvent(event)) {
      const scores = [...state.scores];
      let { passedCount, passFailCount, totalCost, hasCostData } = state;

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

      return {
        ...state,
        scores,
        passedCount,
        passFailCount,
        totalCost,
        hasCostData,
        updatedAt: event.timestamp,
      };
    }

    if (isExperimentRunCompletedEvent(event)) {
      return {
        ...state,
        finishedAt: event.data.finishedAt ?? null,
        stoppedAt: event.data.stoppedAt ?? null,
        updatedAt: event.timestamp,
      };
    }

    return state;
  },

  store: experimentRunStateFoldStore,
};
