import type { Projection } from "../../../";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import { SUITE_RUN_PROJECTION_VERSIONS } from "../schemas/constants";
import type {
  SuiteRunItemCompletedEvent,
  SuiteRunItemStartedEvent,
  SuiteRunStartedEvent,
} from "../schemas/events";
import {
  SuiteRunItemCompletedEventSchema,
  SuiteRunItemStartedEventSchema,
  SuiteRunStartedEventSchema,
} from "../schemas/events";

/**
 * State data for a suite run.
 * Matches the suite_runs ClickHouse table schema.
 *
 * This is both the fold state and the stored data — one type, not two.
 * Handlers do all computation using simple counters (no Sets/arrays).
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
  LastEventOccurredAt: number;
  StartedAt: number | null;
  FinishedAt: number | null;

  // Raw counters for incremental aggregation
  PassedCount: number;
  GradedCount: number;
}

export interface SuiteRunState extends Projection<SuiteRunStateData> {
  data: SuiteRunStateData;
}

function computeCompletionCounts(
  state: SuiteRunStateData,
  isFailure: boolean,
): { completedCount: number; failedCount: number } {
  return isFailure
    ? {
        completedCount: state.CompletedCount,
        failedCount: state.FailedCount + 1,
      }
    : {
        completedCount: state.CompletedCount + 1,
        failedCount: state.FailedCount,
      };
}

function computeGradingCounts(
  state: SuiteRunStateData,
  verdict: SuiteRunItemCompletedEvent["data"]["verdict"],
): { passedCount: number; gradedCount: number } {
  if (!verdict) {
    return { passedCount: state.PassedCount, gradedCount: state.GradedCount };
  }
  const gradedCount = state.GradedCount + 1;
  const passedCount =
    verdict === "success" ? state.PassedCount + 1 : state.PassedCount;
  return { passedCount, gradedCount };
}

function computePassRateBps(
  passedCount: number,
  gradedCount: number,
): number | null {
  return gradedCount > 0
    ? Math.round((passedCount / gradedCount) * 10000)
    : null;
}

function computeFinalization(params: {
  state: SuiteRunStateData;
  progress: number;
  failedCount: number;
  occurredAt: number;
}): { status: string; finishedAt: number | null } {
  const { state, progress, failedCount, occurredAt } = params;
  const allDone = state.Total > 0 && progress >= state.Total;
  if (!allDone) {
    return { status: state.Status, finishedAt: state.FinishedAt };
  }
  return {
    status: failedCount > 0 ? "FAILURE" : "SUCCESS",
    finishedAt: occurredAt,
  };
}

const suiteRunEvents = [
  SuiteRunStartedEventSchema,
  SuiteRunItemStartedEventSchema,
  SuiteRunItemCompletedEventSchema,
] as const;

/**
 * Type-safe fold projection for suite run state.
 *
 * - `implements FoldEventHandlers` enforces a handler exists for every event schema
 * - Handler names derived from event type strings (e.g. `"lw.suite_run.started"` → `handleSuiteRunStarted`)
 * - `UpdatedAt` is auto-managed by the base class after each handler call
 */
export class SuiteRunStateFoldProjection
  extends AbstractFoldProjection<SuiteRunStateData, typeof suiteRunEvents>
  implements FoldEventHandlers<typeof suiteRunEvents, SuiteRunStateData>
{
  readonly name = "suiteRunState";
  readonly version = SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE;
  readonly store: FoldProjectionStore<SuiteRunStateData>;

  protected readonly events = suiteRunEvents;

  constructor(deps: { store: FoldProjectionStore<SuiteRunStateData> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
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
      StartedAt: null,
      FinishedAt: null,
      PassedCount: 0,
      GradedCount: 0,
    };
  }

  handleSuiteRunStarted(
    event: SuiteRunStartedEvent,
    state: SuiteRunStateData,
  ): SuiteRunStateData {
    return {
      ...state,
      BatchRunId: event.data.batchRunId,
      ScenarioSetId: event.data.scenarioSetId,
      SuiteId: event.data.suiteId,
      Total: event.data.total,
      Status: "IN_PROGRESS",
      StartedAt: event.occurredAt,
    };
  }

  handleSuiteRunItemStarted(
    _event: SuiteRunItemStartedEvent,
    state: SuiteRunStateData,
  ): SuiteRunStateData {
    const startedCount = state.StartedCount + 1;
    return {
      ...state,
      StartedCount: startedCount,
      Progress: state.CompletedCount + state.FailedCount,
    };
  }

  handleSuiteRunItemCompleted(
    event: SuiteRunItemCompletedEvent,
    state: SuiteRunStateData,
  ): SuiteRunStateData {
    const isFailure =
      event.data.status === "FAILURE" || event.data.status === "ERROR";

    const { completedCount, failedCount } = computeCompletionCounts(
      state,
      isFailure,
    );
    const { passedCount, gradedCount } = computeGradingCounts(
      state,
      event.data.verdict,
    );
    const passRateBps = computePassRateBps(passedCount, gradedCount);

    const progress = completedCount + failedCount;
    const { status, finishedAt } = computeFinalization({
      state,
      progress,
      failedCount,
      occurredAt: event.occurredAt,
    });

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
    };
  }
}
