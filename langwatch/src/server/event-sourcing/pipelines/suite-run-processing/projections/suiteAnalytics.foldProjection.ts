import { trimAttributesForAnalytics } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/analytics-attribute-trim.service";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
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
 * ADR-034 Phase 7 — slim per-suite-run fold projection.
 *
 * Writes to `suite_analytics` (migration 00045) — a
 * `ReplacingMergeTree(UpdatedAt)` keyed on (TenantId, SuiteRunId).
 *
 * Mirrors `SuiteRunStateFoldProjection`'s per-event logic for the SHARED
 * fields. Trims the `Attributes` map at write time via
 * `trimAttributesForAnalytics`.
 */

const suiteAnalyticsEvents = [
  SuiteRunStartedEventSchema,
  SuiteRunItemStartedEventSchema,
  SuiteRunItemCompletedEventSchema,
] as const;

/** Schema-snapshot version (calendar date). */
export const SUITE_ANALYTICS_PROJECTION_VERSION_LATEST =
  "2026-06-20" as const;

/**
 * Slim row landing in `suite_analytics`. Names align with the CH columns.
 */
export interface SuiteAnalyticsRow {
  tenantId: string;
  suiteRunId: string;
  version: string;
  occurredAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;

  // Hoisted dimensions.
  batchRunId: string;
  scenarioSetId: string;
  suiteId: string;
  status: string;

  // Metric scalars.
  total: number;
  progress: number;
  completedCount: number;
  failedCount: number;
  passRateBps: number | null;

  // Trimmed Attributes map.
  attributes: Record<string, string>;
}

/**
 * In-memory accumulator for the slim suite fold.
 */
export interface SuiteAnalyticsData {
  suiteRunId: string;
  batchRunId: string;
  scenarioSetId: string;
  suiteId: string;
  status: string;

  total: number;
  progress: number;
  completedCount: number;
  failedCount: number;
  passRateBps: number | null;

  // Raw counters — mirror legacy fold so derived values match to the cent.
  passedCount: number;
  gradedCount: number;

  attributes: Record<string, string>;

  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
}

/**
 * Project the in-memory slim state into the slim `SuiteAnalyticsRow`. Pure.
 */
export function projectSuiteAnalyticsStateToRow({
  state,
  tenantId,
  version,
}: {
  state: SuiteAnalyticsData;
  tenantId: string;
  version: string;
}): SuiteAnalyticsRow {
  const attrs = state.attributes ?? {};
  return {
    tenantId,
    suiteRunId: state.suiteRunId,
    version,
    occurredAtMs: state.LastEventOccurredAt,
    createdAtMs: state.createdAt,
    updatedAtMs: state.updatedAt,

    batchRunId: state.batchRunId,
    scenarioSetId: state.scenarioSetId,
    suiteId: state.suiteId,
    status: state.status,

    total: state.total,
    progress: state.progress,
    completedCount: state.completedCount,
    failedCount: state.failedCount,
    passRateBps: state.passRateBps,

    attributes: trimAttributesForAnalytics(attrs),
  };
}

/**
 * Slim fold projection for suites.
 *
 * Handlers mirror `SuiteRunStateFoldProjection`'s per-event logic for the
 * SHARED fields (Status, Progress, CompletedCount, FailedCount, PassRateBps).
 * Total comes off the STARTED event; Status is "PENDING" before, "IN_PROGRESS"
 * after, and rolls into SUCCESS/FAILURE on the final ITEM_COMPLETED that
 * pushes progress to Total. The `suiteRunId` accumulator key is stamped by
 * the store using the aggregateId — the suite-run aggregate's id IS the
 * suiteRunId.
 */
export class SuiteAnalyticsFoldProjection
  extends AbstractFoldProjection<
    SuiteAnalyticsData,
    typeof suiteAnalyticsEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements
    FoldEventHandlers<typeof suiteAnalyticsEvents, SuiteAnalyticsData>
{
  readonly name = "suiteAnalytics";
  readonly version = SUITE_ANALYTICS_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<SuiteAnalyticsData>;

  protected readonly events = suiteAnalyticsEvents;

  constructor(deps: { store: FoldProjectionStore<SuiteAnalyticsData> }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = deps.store;
  }

  protected initState() {
    return {
      suiteRunId: "",
      batchRunId: "",
      scenarioSetId: "",
      suiteId: "",
      status: "PENDING",
      total: 0,
      progress: 0,
      completedCount: 0,
      failedCount: 0,
      passRateBps: null,
      passedCount: 0,
      gradedCount: 0,
      attributes: {},
    };
  }

  handleSuiteRunStarted(
    event: SuiteRunStartedEvent,
    state: SuiteAnalyticsData,
  ): SuiteAnalyticsData {
    return {
      ...state,
      batchRunId: event.data.batchRunId,
      scenarioSetId: event.data.scenarioSetId,
      suiteId: event.data.suiteId,
      total: event.data.total,
      status: "IN_PROGRESS",
    };
  }

  handleSuiteRunItemStarted(
    _event: SuiteRunItemStartedEvent,
    state: SuiteAnalyticsData,
  ): SuiteAnalyticsData {
    return {
      ...state,
      progress: state.completedCount + state.failedCount,
    };
  }

  handleSuiteRunItemCompleted(
    event: SuiteRunItemCompletedEvent,
    state: SuiteAnalyticsData,
  ): SuiteAnalyticsData {
    const isFailure =
      event.data.status === "FAILURE" || event.data.status === "ERROR";
    let completedCount = state.completedCount;
    let failedCount = state.failedCount;
    if (isFailure) {
      failedCount += 1;
    } else {
      completedCount += 1;
    }

    let passedCount = state.passedCount;
    let gradedCount = state.gradedCount;
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
    const allDone = state.total > 0 && progress >= state.total;

    let status = state.status;
    if (allDone) {
      status = failedCount > 0 ? "FAILURE" : "SUCCESS";
    }

    return {
      ...state,
      completedCount,
      failedCount,
      progress,
      passedCount,
      gradedCount,
      passRateBps,
      status,
    };
  }
}
