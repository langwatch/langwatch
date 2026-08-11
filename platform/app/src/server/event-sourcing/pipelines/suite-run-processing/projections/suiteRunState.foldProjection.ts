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
  /** Items cancelled by the user — neither completed nor failed (#6834). */
  CancelledCount: number;
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
      CancelledCount: 0,
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
      Progress: state.CompletedCount + state.FailedCount + state.CancelledCount,
    };
  }

  handleSuiteRunItemCompleted(
    event: SuiteRunItemCompletedEvent,
    state: SuiteRunStateData,
  ): SuiteRunStateData {
    // Every terminal `ScenarioRunStatus` gets an explicit bucket (#6834).
    // The old ladder only knew "FAILURE"/"ERROR", so FAILED, CANCELLED and
    // STALLED items fell through into CompletedCount and a suite could
    // finish SUCCESS with cancelled or stalled items inside it. "FAILURE"
    // is kept as an accepted legacy alias of FAILED for replays of events
    // recorded before the run fold wrote the enum member.
    const isFailure =
      event.data.status === "FAILED" ||
      event.data.status === "FAILURE" ||
      event.data.status === "ERROR" ||
      event.data.status === "STALLED";
    const isCancelled = event.data.status === "CANCELLED";

    let completedCount = state.CompletedCount;
    let failedCount = state.FailedCount;
    let cancelledCount = state.CancelledCount;

    if (isFailure) {
      failedCount += 1;
    } else if (isCancelled) {
      cancelledCount += 1;
    } else {
      completedCount += 1;
    }

    let { PassedCount: passedCount, GradedCount: gradedCount } = state;
    // A cancelled item's verdict is not a grade: the cancel handler stamps
    // `verdict: inconclusive` on user cancellations, and counting it into
    // the denominator would read a cancellation as a non-pass (#6834).
    if (event.data.verdict && !isCancelled) {
      gradedCount += 1;
      if (event.data.verdict === "success") {
        passedCount += 1;
      }
    }

    const passRateBps =
      gradedCount > 0 ? Math.round((passedCount / gradedCount) * 10000) : null;

    const progress = completedCount + failedCount + cancelledCount;
    const allDone = state.Total > 0 && progress >= state.Total;

    let status = state.Status;
    let finishedAt = state.FinishedAt;
    if (allDone) {
      finishedAt = event.occurredAt;
      // FAILED outranks CANCELLED: a failure verdict is the stronger signal.
      // A suite with cancellations and no failures reads CANCELLED rather
      // than SUCCESS — a cancelled item must never be invisible. All three
      // outputs are `ScenarioRunStatus` members.
      status =
        failedCount > 0
          ? "FAILED"
          : cancelledCount > 0
            ? "CANCELLED"
            : "SUCCESS";
    }

    return {
      ...state,
      CompletedCount: completedCount,
      FailedCount: failedCount,
      CancelledCount: cancelledCount,
      Progress: progress,
      PassedCount: passedCount,
      GradedCount: gradedCount,
      PassRateBps: passRateBps,
      Status: status,
      FinishedAt: finishedAt,
    };
  }
}
