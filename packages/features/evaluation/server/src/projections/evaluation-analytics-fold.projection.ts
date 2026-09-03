import type { FoldProjectionOptions, FoldProjectionStore } from "@langwatch/eventing";
import { AbstractFoldProjection, type FoldEventHandlers } from "@langwatch/eventing";
import type {
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
} from "@langwatch/evaluation-contract";
import {
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
  evaluationScheduledEventSchema,
  evaluationStartedEventSchema,
  verdictPassedOf,
  verdictScoreOf,
} from "@langwatch/evaluation-contract";
import { type EvaluationAnalyticsData } from "./evaluation-analytics-row.projection";

export type {
  EvaluationAnalyticsData,
  EvaluationAnalyticsRow,
} from "./evaluation-analytics-row.projection";

const evaluationAnalyticsEvents = [
  evaluationScheduledEventSchema,
  evaluationStartedEventSchema,
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
] as const;

/** Current persisted shape version for evaluation_analytics read-back. */
export const EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST = "2026-07-27" as const;

/** Read-back may trail the scheduled business time by up to one week. */
export const EVALUATION_ANALYTICS_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Bounds the persisted applied-event watermark for a single evaluation. */
export const EVALUATION_ANALYTICS_COALESCE_MAX_BATCH = 128;

function mergeEventMetadata(
  attributes: Record<string, string>,
  metadata: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!metadata) return attributes;

  let merged = attributes;
  let copied = false;
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue;
    }
    if (!copied) {
      merged = { ...merged };
      copied = true;
    }
    merged[key] = typeof value === "string" ? value : String(value);
  }
  return merged;
}

/** Deterministic fold for the slim per-evaluation analytics row. */
export class EvaluationAnalyticsFoldProjection
  extends AbstractFoldProjection<
    EvaluationAnalyticsData,
    typeof evaluationAnalyticsEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements FoldEventHandlers<typeof evaluationAnalyticsEvents, EvaluationAnalyticsData>
{
  static create(deps: {
    store: FoldProjectionStore<EvaluationAnalyticsData>;
  }): EvaluationAnalyticsFoldProjection {
    return new EvaluationAnalyticsFoldProjection(deps);
  }

  readonly name = "evaluationAnalytics";
  readonly version = EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<EvaluationAnalyticsData>;
  protected readonly events = evaluationAnalyticsEvents;

  override options: FoldProjectionOptions = {
    eventOrdering: "acceptedAt",
    refoldOnStoreMiss: true,
    trustAbsentMiss: true,
    refoldOnOutOfOrder: false,
    readWindow: { widthMs: EVALUATION_ANALYTICS_READ_WINDOW_MS },
    coalesceMaxBatch: EVALUATION_ANALYTICS_COALESCE_MAX_BATCH,
  };

  constructor(deps: { store: FoldProjectionStore<EvaluationAnalyticsData> }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = deps.store;
  }

  protected initState() {
    return {
      evaluationId: "",
      evaluatorId: "",
      evaluatorType: "",
      evaluatorName: null,
      status: "scheduled" as const,
      isGuardrail: false,
      passed: null,
      score: null,
      label: null,
      model: null,
      traceId: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      costId: null,
      attributes: {},
    };
  }

  handleEvaluationScheduled(
    event: EvaluationScheduledEvent,
    state: EvaluationAnalyticsData,
  ): EvaluationAnalyticsData {
    return {
      ...state,
      evaluationId: event.data.evaluationId,
      evaluatorId: event.data.evaluatorId,
      evaluatorType: event.data.evaluatorType,
      evaluatorName: event.data.evaluatorName ?? null,
      traceId: event.data.traceId ?? null,
      isGuardrail: event.data.isGuardrail ?? false,
      status: "scheduled",
      scheduledAt: event.occurredAt,
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }

  handleEvaluationStarted(
    event: EvaluationStartedEvent,
    state: EvaluationAnalyticsData,
  ): EvaluationAnalyticsData {
    return {
      ...state,
      evaluationId: state.evaluationId || event.data.evaluationId,
      evaluatorId: state.evaluatorId || event.data.evaluatorId,
      evaluatorType: state.evaluatorType || event.data.evaluatorType,
      evaluatorName: state.evaluatorName ?? event.data.evaluatorName ?? null,
      traceId: state.traceId ?? event.data.traceId ?? null,
      isGuardrail: event.data.isGuardrail ?? state.isGuardrail,
      status: "in_progress",
      startedAt: event.occurredAt,
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }

  handleEvaluationCompleted(
    event: EvaluationCompletedEvent,
    state: EvaluationAnalyticsData,
  ): EvaluationAnalyticsData {
    return {
      ...state,
      evaluationId: state.evaluationId || event.data.evaluationId,
      status: event.data.status,
      score: verdictScoreOf(event.data),
      passed: verdictPassedOf(event.data),
      label: event.data.label ?? null,
      completedAt: event.occurredAt,
      costId: event.data.costId ?? null,
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }

  handleEvaluationReported(
    event: EvaluationReportedEvent,
    state: EvaluationAnalyticsData,
  ): EvaluationAnalyticsData {
    return {
      ...state,
      evaluationId: event.data.evaluationId,
      evaluatorId: event.data.evaluatorId,
      evaluatorType: event.data.evaluatorType,
      evaluatorName: event.data.evaluatorName ?? null,
      traceId: event.data.traceId ?? null,
      isGuardrail: event.data.isGuardrail ?? false,
      status: event.data.status,
      score: verdictScoreOf(event.data),
      passed: verdictPassedOf(event.data),
      label: event.data.label ?? null,
      startedAt: event.occurredAt,
      completedAt: event.occurredAt,
      costId: event.data.costId ?? null,
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }
}
