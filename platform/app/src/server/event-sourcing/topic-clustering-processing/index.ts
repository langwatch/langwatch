import {
  type ClickHouseClient,
  clickhouseReplacing,
  noFoldStateCache,
} from "@langwatch/clickhouse";
import {
  ConfigurationError,
  definePipeline,
  type GroupKey,
  type HandlerContext,
  type Metrics,
  type Mount,
  validateMount,
} from "@langwatch/event-sourcing";
import {
  TOPIC_CLUSTERING_PIPELINE_NAME,
  TOPIC_CLUSTERING_PIPELINE_PREFIX,
  topicClusteringEvents,
} from "./events";
import {
  initTopicClusteringScheduleState,
  onClusteringRequested,
  onClusteringRunCompleted,
  onClusteringRunFailed,
  onTopicClusteringWake,
  TOPIC_CLUSTERING_PROCESS_NAME,
  type TopicClusteringDispatchPorts,
  topicClusteringRunIntentPayloadSchema,
  topicClusteringRunMessageKey,
  topicClusteringScheduleStateSchema,
} from "./process";
import {
  handleRunCompleted as applyRunHistoryRunCompleted,
  handleRunFailed as applyRunHistoryRunFailed,
  handleRunStarted as applyRunHistoryRunStarted,
  initRunHistoryState,
  runHistoryStateSchema,
} from "./projections/runHistory";
import {
  handleRequested as applyRunStatusRequested,
  handleRunCompleted as applyRunStatusRunCompleted,
  handleRunFailed as applyRunStatusRunFailed,
  handleRunStarted as applyRunStatusRunStarted,
  initRunStatusState,
  runStatusStateSchema,
} from "./projections/runStatus";
import {
  applyTopicsRecorded,
  initTopicModelState,
  topicModelStateSchema,
} from "./projections/topicModel";
import { recordClusteringRunCompleted } from "./recordClusteringRunCompleted.command";
import { recordClusteringRunFailed } from "./recordClusteringRunFailed.command";
import { recordClusteringRunStarted } from "./recordClusteringRunStarted.command";
import { recordTopics } from "./recordTopics.command";
import { requestClustering } from "./requestClustering.command";
import {
  foldStateRow,
  topicClusteringRunHistoryTable,
  topicClusteringRunStatusTable,
  topicModelTable,
} from "./tables";

export {
  TOPIC_CLUSTERING_PIPELINE_NAME,
  TOPIC_CLUSTERING_PIPELINE_PREFIX,
} from "./events";
export type {
  TopicClusteringDispatchPorts,
  TopicClusteringRunIntentPayload,
} from "./process";
export { nextDailySlot, TOPIC_CLUSTERING_STALE_RUN_MS } from "./process";
export type {
  RunHistoryOutcome,
  RunHistoryViewEntry,
} from "./projections/runHistory";
export {
  deriveRunHistoryView,
  RUN_HISTORY_LIMIT,
} from "./projections/runHistory";
export type { RunStatusView } from "./projections/runStatus";
export { deriveRunStatusView } from "./projections/runStatus";
export type { ProjectedTopic, TopicModelView } from "./projections/topicModel";
export { deriveTopicModelView } from "./projections/topicModel";

/**
 * The deployed stamps from the retired tree's topic-clustering constants,
 * `TOPIC_CLUSTERING_PROJECTION_VERSIONS`. That tree kept these three read
 * models in Postgres; wiring them to ClickHouse here is a storage change this
 * conversion does not resolve — the pin travels with the fold regardless, so
 * a later migration that copies rows across storage keeps the same version
 * identity rather than inventing a new one.
 */
export const TOPIC_CLUSTERING_RUN_STATUS_VERSION_PIN = "2026-07-17";
export const TOPIC_CLUSTERING_RUN_HISTORY_VERSION_PIN = "2026-07-20";
export const TOPIC_MODEL_VERSION_PIN = "2026-07-20";

/** One lane per project everywhere: the aggregate is the project's clustering
 * stream, and every fold, command and the process manager mirror it 1:1. */
function projectScope(tenantId: string) {
  return {
    kind: "aggregate",
    aggregateType: TOPIC_CLUSTERING_PIPELINE_NAME,
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
    lane: { kind: "processManager", name: "topicClustering" },
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
function assertMountIsLegal(projection: string, mount: Mount): Mount {
  const violations = validateMount(mount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `topic-clustering-processing's ${projection} mount is illegal: ${violations
        .map((v) => `${v.rule} — ${v.message}`)
        .join("; ")}`,
      { pipeline: TOPIC_CLUSTERING_PIPELINE_NAME, projection, violations },
    );
  }
  return mount;
}

export interface TopicClusteringProcessingDeps {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
  /** The clustering effect itself and the pipeline's own commands, adapted by
   * the composition root (ADR-105 decision 6). */
  readonly ports: TopicClusteringDispatchPorts;
}

export function createTopicClusteringProcessingPipeline(
  deps: TopicClusteringProcessingDeps,
) {
  const runStatusStore = clickhouseReplacing({
    client: deps.client,
    table: topicClusteringRunStatusTable,
    version: TOPIC_CLUSTERING_RUN_STATUS_VERSION_PIN,
    key: "ProjectId",
    stateVersionColumn: "StateVersion",
    row: foldStateRow<ReturnType<typeof initRunStatusState>>(),
    // No cache tier exists for this fold yet — a deliberate point read per
    // delivery, not an oversight.
    cache: noFoldStateCache(),
  });
  assertMountIsLegal("topicClusteringRunStatus", {
    projection: "fold",
    store: runStatusStore.kind,
    scope: "aggregate",
    collapse: "batch",
  });

  const runHistoryStore = clickhouseReplacing({
    client: deps.client,
    table: topicClusteringRunHistoryTable,
    version: TOPIC_CLUSTERING_RUN_HISTORY_VERSION_PIN,
    key: "ProjectId",
    stateVersionColumn: "StateVersion",
    row: foldStateRow<ReturnType<typeof initRunHistoryState>>(),
    cache: noFoldStateCache(),
  });
  assertMountIsLegal("topicClusteringRunHistory", {
    projection: "fold",
    store: runHistoryStore.kind,
    scope: "aggregate",
    collapse: "batch",
  });

  const topicModelStore = clickhouseReplacing({
    client: deps.client,
    table: topicModelTable,
    version: TOPIC_MODEL_VERSION_PIN,
    key: "ProjectId",
    stateVersionColumn: "StateVersion",
    row: foldStateRow<ReturnType<typeof initTopicModelState>>(),
    cache: noFoldStateCache(),
  });
  assertMountIsLegal("topicModel", {
    projection: "fold",
    store: topicModelStore.kind,
    scope: "aggregate",
    collapse: "batch",
  });

  const idByProjectId = {
    requested: (data: { projectId: string }) => data.projectId,
    runStarted: (data: { projectId: string }) => data.projectId,
    runCompleted: (data: { projectId: string }) => data.projectId,
    runFailed: (data: { projectId: string }) => data.projectId,
    topicsRecorded: (data: { projectId: string }) => data.projectId,
  };

  return definePipeline(TOPIC_CLUSTERING_PIPELINE_NAME)
    .prefix(TOPIC_CLUSTERING_PIPELINE_PREFIX)
    .events(topicClusteringEvents)
    .id(idByProjectId)
    .withCommand("requestClustering", {
      input: topicClusteringEvents.requested,
      handle: requestClustering,
    })
    .withCommand("recordClusteringRunStarted", {
      input: topicClusteringEvents.runStarted,
      handle: recordClusteringRunStarted,
    })
    .withCommand("recordClusteringRunCompleted", {
      input: topicClusteringEvents.runCompleted,
      handle: recordClusteringRunCompleted,
    })
    .withCommand("recordClusteringRunFailed", {
      input: topicClusteringEvents.runFailed,
      handle: recordClusteringRunFailed,
    })
    .withCommand("recordTopics", {
      input: topicClusteringEvents.topicsRecorded,
      handle: recordTopics,
    })
    .withFold("topicClusteringRunStatus", {
      state: runStatusStateSchema,
      init: initRunStatusState,
      pin: TOPIC_CLUSTERING_RUN_STATUS_VERSION_PIN,
      on: {
        requested: applyRunStatusRequested,
        runStarted: applyRunStatusRunStarted,
        runCompleted: applyRunStatusRunCompleted,
        runFailed: applyRunStatusRunFailed,
      },
      store: runStatusStore,
    })
    .withFold("topicClusteringRunHistory", {
      state: runHistoryStateSchema,
      init: initRunHistoryState,
      pin: TOPIC_CLUSTERING_RUN_HISTORY_VERSION_PIN,
      on: {
        runStarted: applyRunHistoryRunStarted,
        runCompleted: applyRunHistoryRunCompleted,
        runFailed: applyRunHistoryRunFailed,
      },
      store: runHistoryStore,
    })
    .withFold("topicModel", {
      state: topicModelStateSchema,
      init: initTopicModelState,
      pin: TOPIC_MODEL_VERSION_PIN,
      on: { topicsRecorded: applyTopicsRecorded },
      store: topicModelStore,
    })
    .withProcessManager(TOPIC_CLUSTERING_PROCESS_NAME, {
      state: topicClusteringScheduleStateSchema,
      init: initTopicClusteringScheduleState,
      intents: {
        run: {
          payload: topicClusteringRunIntentPayloadSchema,
          messageKey: topicClusteringRunMessageKey,
          deliver: (payload, ctx: HandlerContext) =>
            deps.ports.runClusteringPage(payload, ctx),
        },
      },
      on: {
        requested: onClusteringRequested,
        runCompleted: onClusteringRunCompleted,
        runFailed: onClusteringRunFailed,
      },
      onWake: onTopicClusteringWake,
    })
    .build({ metrics: deps.metrics });
}

export type TopicClusteringProcessingPipeline = ReturnType<
  typeof createTopicClusteringProcessingPipeline
>;
