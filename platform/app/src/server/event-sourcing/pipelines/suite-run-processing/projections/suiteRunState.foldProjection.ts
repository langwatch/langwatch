import type { FoldProjectionStore, Projection } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "@langwatch/eventing";
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

export type { SuiteRunStateData } from "@langwatch/suite-contract";

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

    const passRateBps =
      gradedCount > 0 ? Math.round((passedCount / gradedCount) * 10000) : null;

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
}
