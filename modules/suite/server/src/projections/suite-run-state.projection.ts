import type { FoldProjectionStore, Projection } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import { AbstractFoldProjection, type FoldEventHandlers } from "@langwatch/eventing";
import { SUITE_RUN_PROJECTION_VERSIONS } from "@langwatch/suite-contract";
import type {
  SuiteRunItemCompletedEvent,
  SuiteRunItemRegradedEvent,
  SuiteRunItemStartedEvent,
  SuiteRunStartedEvent,
} from "@langwatch/suite-contract";
import {
  SuiteRunItemCompletedEventSchema,
  SuiteRunItemRegradedEventSchema,
  SuiteRunItemStartedEventSchema,
  SuiteRunStartedEventSchema,
} from "@langwatch/suite-contract";

export type { SuiteRunStateData } from "@langwatch/suite-contract";

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
 */
export class SuiteRunStateFoldProjection
  extends AbstractFoldProjection<SuiteRunStateData, typeof suiteRunEvents>
  implements FoldEventHandlers<typeof suiteRunEvents, SuiteRunStateData>
{
  static create(deps: {
    store: FoldProjectionStore<SuiteRunStateData>;
  }): SuiteRunStateFoldProjection {
    return new SuiteRunStateFoldProjection(deps);
  }

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

  handleSuiteRunStarted(event: SuiteRunStartedEvent, state: SuiteRunStateData): SuiteRunStateData {
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
<<<<<<< HEAD:modules/suite/server/src/projections/suite-run-state.projection.ts
    const isFailure = event.data.status === "FAILURE" || event.data.status === "ERROR";
=======
    const isFailure = isFailedItemStatus(event.data.status);
>>>>>>> origin/main:platform/app/src/server/event-sourcing/pipelines/suite-run-processing/projections/suiteRunState.foldProjection.ts

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

<<<<<<< HEAD:modules/suite/server/src/projections/suite-run-state.projection.ts
    const passRateBps = gradedCount > 0 ? Math.round((passedCount / gradedCount) * 10000) : null;
=======
    const passRateBps = passRateBpsOf({
      passed: passedCount,
      graded: gradedCount,
    });
>>>>>>> origin/main:platform/app/src/server/event-sourcing/pipelines/suite-run-processing/projections/suiteRunState.foldProjection.ts

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
