/**
 * `topic-clustering-processing` — the `topic_clustering` aggregate, its
 * three fold projections, and its scheduling process manager (ADR-098,
 * ADR-105).
 *
 * Everything below is pure declaration and pure domain logic: the aggregate
 * and its commands (`aggregate.ts`), the run-status/run-history/topic-model
 * folds (`projections/`), the daily-wake process manager
 * (`process-manager/`), and the dispatch-plane descriptors that name where
 * each of those belongs (`groupKey.ts`, `mount.ts`). `tables.ts` proposes a
 * ClickHouse-backed store shape for the three folds but does not construct
 * one — see its module docblock for why concrete store wiring (and the
 * Postgres-vs-ClickHouse question behind it) is left to the composition
 * root, which does not exist yet for this pipeline. No pipeline builder
 * mounts any of this together either, for the same reason: nothing in
 * `@langwatch/event-sourcing` yet composes a fold/command/process-manager
 * set into a runnable pipeline (ADR-102's composition root). This module is
 * therefore the complete set of what CAN be built without one.
 */

export {
  recordClusteringRunCompletedIdempotencyKey,
  recordClusteringRunFailedIdempotencyKey,
  recordClusteringRunStartedIdempotencyKey,
  recordTopicsIdempotencyKey,
  requestClusteringIdempotencyKey,
  type TopicClusteringAggregate,
  type TopicClusteringEventKey,
  topicClustering,
  topicClusteringAggregateId,
  topicClusteringEventKeyOf,
} from "./aggregate";
export {
  topicClusteringCommandGroupKey,
  topicClusteringProcessGroupKey,
  topicClusteringRunHistoryGroupKey,
  topicClusteringRunStatusGroupKey,
  topicModelGroupKey,
} from "./groupKey";
export {
  assertTopicClusteringMountsAreLegal,
  topicClusteringRunHistoryMount,
  topicClusteringRunStatusMount,
  topicModelMount,
} from "./mount";
export type {
  TopicClusteringBootstrapRequest,
  TopicClusteringDispatchPorts,
} from "./process-manager/dispatchPorts";
export type {
  TopicClusteringRunIntentPayload,
  TopicClusteringScheduleState,
} from "./process-manager/schedule";
export {
  evolveRequested,
  evolveRunCompleted,
  evolveRunFailed,
  initTopicClusteringScheduleState,
  nextDailySlot,
  onTopicClusteringWake,
  TOPIC_CLUSTERING_PROCESS_NAME,
  TOPIC_CLUSTERING_STALE_RUN_MS,
  topicClusteringIntentSchemas,
  topicClusteringProcessDefinition,
  topicClusteringRunIntentPayloadSchema,
  topicClusteringScheduleStateSchema,
} from "./process-manager/schedule";
export type {
  RunHistoryEntry,
  RunHistoryOutcome,
  RunHistoryState,
  RunHistoryViewEntry,
} from "./projections/runHistory";
export {
  applyRunHistoryEvent,
  deriveRunHistoryView,
  initRunHistoryState,
  RUN_HISTORY_LIMIT,
  runHistoryStateSchema,
} from "./projections/runHistory";
export type {
  RunStatusState,
  RunStatusView,
  TerminalOutcome,
} from "./projections/runStatus";
export {
  applyRunStatusEvent,
  deriveRunStatusView,
  initRunStatusState,
  runStatusStateSchema,
} from "./projections/runStatus";
export type {
  ProjectedTopic,
  TopicModelState,
  TopicModelView,
} from "./projections/topicModel";
export {
  applyTopicModelEvent,
  deriveTopicModelView,
  initTopicModelState,
  topicModelStateSchema,
} from "./projections/topicModel";
export {
  isManualRun,
  mintManualRunId,
  mintScheduledRunId,
  runIsNewer,
  runRank,
} from "./runIdentity";
export type {
  RequestedData,
  RunCompletedData,
  RunFailedData,
  RunStartedData,
  TopicClusteringRunMode,
  TopicClusteringSearchAfter,
  TopicClusteringSkipReason,
  TopicClusteringTrigger,
  TopicModelEntry,
  TopicModelRecordMode,
  TopicModelRecordSource,
  TopicsRecordedData,
} from "./schema";
export {
  requestedDataSchema,
  runCompletedDataSchema,
  runFailedDataSchema,
  runStartedDataSchema,
  topicClusteringRunModeSchema,
  topicClusteringSearchAfterSchema,
  topicClusteringSkipReasonSchema,
  topicClusteringTriggerSchema,
  topicModelEntrySchema,
  topicModelRecordModeSchema,
  topicModelRecordSourceSchema,
  topicsRecordedDataSchema,
} from "./schema";
export {
  topicClusteringRunHistoryTable,
  topicClusteringRunStatusTable,
  topicModelTable,
} from "./tables";
