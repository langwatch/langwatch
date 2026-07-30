import type { ClickHouseClient, TableDefinition } from "@langwatch/clickhouse";
import { clickhouseReplacing } from "@langwatch/clickhouse";
import type {
  FoldProjection,
  GroupKey,
  Metrics,
  Mount,
} from "@langwatch/event-sourcing";
import {
  ConfigurationError,
  createFoldExecutor,
  validateMount,
} from "@langwatch/event-sourcing";
import { topicClustering } from "./aggregate";
import { topicClusteringProcess } from "./process";
import { topicClusteringRunHistory } from "./projections/runHistory";
import { topicClusteringRunStatus } from "./projections/runStatus";
import { topicModel } from "./projections/topicModel";
import {
  type FoldStateColumns,
  foldStateRow,
  topicClusteringRunHistoryTable,
  topicClusteringRunStatusTable,
  topicModelTable,
} from "./tables";

export {
  recordClusteringRunCompletedIdempotencyKey,
  recordClusteringRunFailedIdempotencyKey,
  recordClusteringRunStartedIdempotencyKey,
  recordTopicsIdempotencyKey,
  requestClusteringIdempotencyKey,
  type TopicClusteringAggregate,
  topicClustering,
} from "./aggregate";
export type {
  TopicClusteringDispatchPorts,
  TopicClusteringRunIntentPayload,
  TopicClusteringScheduleState,
} from "./process";
export {
  initTopicClusteringScheduleState,
  nextDailySlot,
  onTopicClusteringWake,
  TOPIC_CLUSTERING_PROCESS_NAME,
  TOPIC_CLUSTERING_STALE_RUN_MS,
  topicClusteringProcess,
  topicClusteringRunIntentPayloadSchema,
  topicClusteringScheduleStateSchema,
} from "./process";
export type {
  RunHistoryEntry,
  RunHistoryOutcome,
  RunHistoryState,
  RunHistoryViewEntry,
} from "./projections/runHistory";
export {
  deriveRunHistoryView,
  initRunHistoryState,
  RUN_HISTORY_LIMIT,
  runHistoryStateSchema,
  topicClusteringRunHistory,
} from "./projections/runHistory";
export type {
  RunStatusState,
  RunStatusView,
  TerminalOutcome,
} from "./projections/runStatus";
export {
  deriveRunStatusView,
  initRunStatusState,
  runStatusStateSchema,
  topicClusteringRunStatus,
} from "./projections/runStatus";
export type {
  ProjectedTopic,
  TopicModelState,
  TopicModelView,
} from "./projections/topicModel";
export {
  deriveTopicModelView,
  initTopicModelState,
  topicModel,
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

/** One lane per project everywhere: the aggregate is the project's clustering
 * stream, and every fold, command and the process manager mirror it 1:1. */
function projectScope(tenantId: string) {
  return {
    kind: "aggregate",
    aggregateType: topicClustering.name,
    aggregateId: tenantId,
  } as const;
}

export function topicClusteringCommandGroupKey(args: {
  tenantId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command" },
    scope: projectScope(args.tenantId),
  };
}

export function topicClusteringProcessGroupKey(args: {
  tenantId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "processManager", name: topicClusteringProcess.name },
    scope: projectScope(args.tenantId),
  };
}

export function topicClusteringFoldGroupKey(args: {
  tenantId: string;
  projection: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: args.projection },
    scope: projectScope(args.tenantId),
  };
}

/** Refused at composition, never at the first delivery (ADR-106). */
function legalMount(projection: string, mount: Mount): Mount {
  const violations = validateMount(mount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `topic-clustering-processing's ${projection} mount is illegal: ${violations
        .map((violation) => `${violation.rule} — ${violation.message}`)
        .join("; ")}`,
      { pipeline: "topic_clustering_processing", projection, violations },
    );
  }
  return mount;
}

export interface TopicClusteringProcessingDeps {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
}

/** All three folds share one table shape — the whole state in one JSON column,
 * keyed by project — so they share one mount, one lane shape and one store. */
function projectFold<State>(
  projection: FoldProjection<State>,
  table: TableDefinition<FoldStateColumns<State>>,
  deps: TopicClusteringProcessingDeps,
) {
  return {
    projection,
    mount: legalMount(projection.name, {
      projection: "fold",
      store: "replace",
      scope: "aggregate",
      collapse: "batch",
    }),
    groupKey: (args: { tenantId: string }): GroupKey =>
      topicClusteringFoldGroupKey({ ...args, projection: projection.name }),
    executor: createFoldExecutor({
      store: clickhouseReplacing<State, FoldStateColumns<State>>({
        client: deps.client,
        table,
        version: projection.version,
        key: "ProjectId",
        stateVersionColumn: "StateVersion",
        row: foldStateRow<State>(),
      }),
      init: projection.init,
      apply: projection.apply,
      stateVersion: projection.version,
      projectionName: projection.name,
      metrics: deps.metrics,
    }),
  };
}

/** The whole topology: one aggregate, three folds, one process manager. */
export function topicClusteringProcessing(deps: TopicClusteringProcessingDeps) {
  return {
    aggregate: topicClustering,
    commandGroupKey: topicClusteringCommandGroupKey,
    process: {
      definition: topicClusteringProcess,
      groupKey: topicClusteringProcessGroupKey,
    },
    folds: {
      topicClusteringRunStatus: projectFold(
        topicClusteringRunStatus,
        topicClusteringRunStatusTable,
        deps,
      ),
      topicClusteringRunHistory: projectFold(
        topicClusteringRunHistory,
        topicClusteringRunHistoryTable,
        deps,
      ),
      topicModel: projectFold(topicModel, topicModelTable, deps),
    },
  };
}
