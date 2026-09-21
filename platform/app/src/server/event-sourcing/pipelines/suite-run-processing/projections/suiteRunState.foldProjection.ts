import type { Projection } from "../../../";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import { SUITE_RUN_PROJECTION_VERSIONS } from "../schemas/constants";
import type {
  SuiteRunItemCompletedEvent,
  SuiteRunItemRegradedEvent,
  SuiteRunItemStartedEvent,
  SuiteRunStartedEvent,
} from "../schemas/events";
import {
  SuiteRunItemCompletedEventSchema,
  SuiteRunItemRegradedEventSchema,
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

const suiteRunEvents = [
  SuiteRunStartedEventSchema,
  SuiteRunItemStartedEventSchema,
  SuiteRunItemCompletedEventSchema,
  SuiteRunItemRegradedEventSchema,
] as const;

/** Whether an item with this status counts as a failed item. */
function isFailedItemStatus(status: string): boolean {
  return status === "FAILURE" || status === "ERROR";
}

/**
 * The counters one item adds to the suite run: which completion bucket it
 * sits in, whether the judge graded it, and whether it passed.
 */
function itemCounts({
  status,
  verdict,
}: {
  status: string;
  verdict: string | undefined;
}): { completed: number; failed: number; graded: number; passed: number } {
  const failed = isFailedItemStatus(status) ? 1 : 0;
  return {
    completed: 1 - failed,
    failed,
    graded: verdict ? 1 : 0,
    passed: verdict === "success" ? 1 : 0,
  };
}

function passRateBpsOf({
  passed,
  graded,
}: {
  passed: number;
  graded: number;
}): number | null {
  return graded > 0 ? Math.round((passed / graded) * 10000) : null;
}

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
    const isFailure = isFailedItemStatus(event.data.status);

    let completedCount = state.CompletedCount;
    let failedCount = state.FailedCount;

    if (isFailure) {
      failedCount += 1;
    } else {
      completedCount += 1;
    }

    let { PassedCount: passedCount, GradedCount: gradedCount } = state;
    if (event.data.verdict) {
      gradedCount += 1;
      if (event.data.verdict === "success") {
        passedCount += 1;
      }
    }

    const passRateBps = passRateBpsOf({
      passed: passedCount,
      graded: gradedCount,
    });

    const progress = completedCount + failedCount;
    const allDone = state.Total > 0 && progress >= state.Total;

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
    };
  }

  handleSuiteRunItemRegraded(
    event: SuiteRunItemRegradedEvent,
    state: SuiteRunStateData,
  ): SuiteRunStateData {
    // The item already counted once, when it completed. Move it from the
    // bucket it counted in to the one it counts in now; progress and the
    // finish time do not move, only which side of the line the item is on.
    const before = itemCounts({
      status: event.data.previousStatus,
      verdict: event.data.previousVerdict,
    });
    const after = itemCounts({
      status: event.data.status,
      verdict: event.data.verdict,
    });

    const completedCount = Math.max(
      0,
      state.CompletedCount - before.completed + after.completed,
    );
    const failedCount = Math.max(
      0,
      state.FailedCount - before.failed + after.failed,
    );
    const gradedCount = Math.max(
      0,
      state.GradedCount - before.graded + after.graded,
    );
    const passedCount = Math.max(
      0,
      state.PassedCount - before.passed + after.passed,
    );

    const finished = state.FinishedAt != null;
    return {
      ...state,
      CompletedCount: completedCount,
      FailedCount: failedCount,
      Progress: completedCount + failedCount,
      GradedCount: gradedCount,
      PassedCount: passedCount,
      PassRateBps: passRateBpsOf({ passed: passedCount, graded: gradedCount }),
      Status: finished
        ? failedCount > 0
          ? "FAILURE"
          : "SUCCESS"
        : state.Status,
    };
  }
}
