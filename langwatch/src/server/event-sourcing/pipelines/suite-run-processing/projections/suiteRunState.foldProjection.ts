import type { Projection } from "../../../";
import type {
  FoldProjectionDefinition,
  FoldProjectionStore,
} from "../../../projections/foldProjection.types";
import {
  SUITE_RUN_PROCESSING_EVENT_TYPES,
  SUITE_RUN_PROJECTION_VERSIONS,
} from "../schemas/constants";
import type { SuiteRunProcessingEvent } from "../schemas/events";
import {
  isSuiteRunStartedEvent,
  isSuiteRunScenarioResultEvent,
  isSuiteRunCompletedEvent,
} from "../schemas/typeGuards";

/**
 * State data for a suite run.
 * Matches the suite_runs ClickHouse table schema.
 *
 * This is both the fold state and the stored data -- one type, not two.
 * `apply()` does all computation. Store is a dumb read/write layer.
 */
export interface SuiteRunStateData {
  SuiteId: string;
  BatchRunId: string;
  SetId: string;
  Total: number;
  Progress: number;
  CompletedCount: number;
  FailedCount: number;
  ErroredCount: number;
  CancelledCount: number;
  PassRateBps: number | null;
  Status: string;
  ScenarioIds: string;
  Targets: string;
  RepeatCount: number;
  IdempotencyKey: string;
  CreatedAt: number;
  UpdatedAt: number;
  StartedAt: number | null;
  FinishedAt: number | null;
}

export interface SuiteRunState extends Projection<SuiteRunStateData> {
  data: SuiteRunStateData;
}

function init(): SuiteRunStateData {
  return {
    SuiteId: "",
    BatchRunId: "",
    SetId: "",
    Total: 0,
    Progress: 0,
    CompletedCount: 0,
    FailedCount: 0,
    ErroredCount: 0,
    CancelledCount: 0,
    PassRateBps: null,
    Status: "PENDING",
    ScenarioIds: "[]",
    Targets: "[]",
    RepeatCount: 1,
    IdempotencyKey: "",
    CreatedAt: Date.now(),
    UpdatedAt: Date.now(),
    StartedAt: null,
    FinishedAt: null,
  };
}

function calculatePassRateBps(completed: number, failed: number): number | null {
  const graded = completed + failed;
  if (graded === 0) return null;
  return Math.round((completed / graded) * 10000);
}

function apply(
  state: SuiteRunStateData,
  event: SuiteRunProcessingEvent,
): SuiteRunStateData {
  if (isSuiteRunStartedEvent(event)) {
    return {
      ...state,
      SuiteId: event.data.suiteId,
      BatchRunId: event.data.batchRunId,
      SetId: event.data.setId,
      Total: event.data.total,
      ScenarioIds: JSON.stringify(event.data.scenarioIds),
      Targets: JSON.stringify(event.data.targets),
      RepeatCount: event.data.repeatCount,
      IdempotencyKey: event.data.idempotencyKey ?? "",
      Status: "IN_PROGRESS",
      StartedAt: event.occurredAt,
      UpdatedAt: Date.now(),
    };
  }

  if (isSuiteRunScenarioResultEvent(event)) {
    const status = event.data.status.toUpperCase();
    let completedCount = state.CompletedCount;
    let failedCount = state.FailedCount;
    let erroredCount = state.ErroredCount;
    let cancelledCount = state.CancelledCount;

    if (status === "SUCCESS") {
      completedCount++;
    } else if (status === "FAILURE") {
      failedCount++;
    } else if (status === "ERROR") {
      erroredCount++;
    } else if (status === "CANCELLED") {
      cancelledCount++;
    }

    const progress = completedCount + failedCount + erroredCount + cancelledCount;
    const passRateBps = calculatePassRateBps(completedCount, failedCount);

    const isComplete = progress >= state.Total && state.Total > 0;

    return {
      ...state,
      CompletedCount: completedCount,
      FailedCount: failedCount,
      ErroredCount: erroredCount,
      CancelledCount: cancelledCount,
      Progress: progress,
      PassRateBps: passRateBps,
      Status: isComplete ? "COMPLETED" : state.Status,
      FinishedAt: isComplete ? Date.now() : state.FinishedAt,
      UpdatedAt: Date.now(),
    };
  }

  if (isSuiteRunCompletedEvent(event)) {
    return {
      ...state,
      Status: "COMPLETED",
      FinishedAt: event.data.finishedAt,
      UpdatedAt: Date.now(),
    };
  }

  return state;
}

/**
 * Creates FoldProjection definition for suite run state.
 *
 * Fold state = stored data. Pure state transitions, no side effects.
 */
export function createSuiteRunStateFoldProjection(deps: {
  store: FoldProjectionStore<SuiteRunStateData>;
}): FoldProjectionDefinition<
  SuiteRunStateData,
  SuiteRunProcessingEvent
> {
  return {
    name: "suiteRunState",
    version: SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE,
    eventTypes: SUITE_RUN_PROCESSING_EVENT_TYPES,
    init,
    apply,
    store: deps.store,
  };
}
