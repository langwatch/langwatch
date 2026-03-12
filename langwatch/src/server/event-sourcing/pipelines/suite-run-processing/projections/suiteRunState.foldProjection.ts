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
  isSuiteRunItemStartedEvent,
  isSuiteRunItemCompletedEvent,
} from "../schemas/typeGuards";

/**
 * State data for a suite run.
 * Matches the suite_runs ClickHouse table schema.
 *
 * This is both the fold state and the stored data — one type, not two.
 * `apply()` does all computation using simple counters (no Sets/arrays).
 * Store is a dumb read/write layer.
 */
export interface SuiteRunStateData {
  SuiteRunId: string;
  BatchRunId: string;
  ScenarioSetId: string;
  SuiteId: string;
  Status: string;
  Total: number;
  StartedCount: number;
  CompletedCount: number;
  FailedCount: number;
  Progress: number;
  PassRateBps: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  StartedAt: number | null;
  FinishedAt: number | null;

  // Raw counters for incremental aggregation
  PassedCount: number;
  GradedCount: number;
}

export interface SuiteRunState extends Projection<SuiteRunStateData> {
  data: SuiteRunStateData;
}

function init(): SuiteRunStateData {
  return {
    SuiteRunId: "",
    BatchRunId: "",
    ScenarioSetId: "",
    SuiteId: "",
    Status: "PENDING",
    Total: 0,
    StartedCount: 0,
    CompletedCount: 0,
    FailedCount: 0,
    Progress: 0,
    PassRateBps: null,
    CreatedAt: Date.now(),
    UpdatedAt: Date.now(),
    StartedAt: null,
    FinishedAt: null,
    PassedCount: 0,
    GradedCount: 0,
  };
}

function apply(
  state: SuiteRunStateData,
  event: SuiteRunProcessingEvent,
): SuiteRunStateData {
  if (isSuiteRunStartedEvent(event)) {
    return {
      ...state,
      BatchRunId: event.data.batchRunId,
      ScenarioSetId: event.data.scenarioSetId,
      SuiteId: event.data.suiteId,
      Total: event.data.total,
      Status: "IN_PROGRESS",
      StartedAt: event.occurredAt,
      UpdatedAt: Date.now(),
    };
  }

  if (isSuiteRunItemStartedEvent(event)) {
    const startedCount = state.StartedCount + 1;
    return {
      ...state,
      StartedCount: startedCount,
      Progress: state.CompletedCount + state.FailedCount,
      UpdatedAt: Date.now(),
    };
  }

  if (isSuiteRunItemCompletedEvent(event)) {
    const isFailure =
      event.data.status === "FAILURE" ||
      event.data.status === "ERROR";

    let completedCount = state.CompletedCount;
    let failedCount = state.FailedCount;

    if (isFailure) {
      failedCount += 1;
    } else {
      completedCount += 1;
    }

    // Update pass rate if verdict is present
    let { PassedCount: passedCount, GradedCount: gradedCount } = state;
    if (event.data.verdict) {
      gradedCount += 1;
      if (event.data.verdict === "success") {
        passedCount += 1;
      }
    }

    const passRateBps =
      gradedCount > 0
        ? Math.round((passedCount / gradedCount) * 10000)
        : null;

    const progress = completedCount + failedCount;
    const allDone = state.Total > 0 && progress >= state.Total;

    // Derive final status when all items are done
    let status = state.Status;
    let finishedAt = state.FinishedAt;
    if (allDone) {
      finishedAt = event.occurredAt;
      status = failedCount > 0 ? "FAILURE" : "SUCCESS";
    }

    return {
      ...state,
      CompletedCount: completedCount,
      FailedCount: failedCount,
      Progress: progress,
      PassedCount: passedCount,
      GradedCount: gradedCount,
      PassRateBps: passRateBps,
      Status: status,
      FinishedAt: finishedAt,
      UpdatedAt: Date.now(),
    };
  }

  return state;
}

/**
 * Creates FoldProjection definition for suite run state.
 *
 * Fold state = stored data. Uses simple counters instead of Sets/arrays
 * so state round-trips through the store without loss.
 */
export function createSuiteRunStateFoldProjection(deps: {
  store: FoldProjectionStore<SuiteRunStateData>;
}): FoldProjectionDefinition<SuiteRunStateData, SuiteRunProcessingEvent> {
  return {
    name: "suiteRunState",
    version: SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE,
    eventTypes: SUITE_RUN_PROCESSING_EVENT_TYPES,
    init,
    apply,
    store: deps.store,
  };
}
