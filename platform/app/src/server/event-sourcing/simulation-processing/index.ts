import {
  type ClickHouseClient,
  clickhouseAppend,
  clickhouseReplacing,
  deriveAppendMapping,
  deriveRowMapping,
  type FoldStateCache,
  noFoldStateCache,
  type RowMapping,
} from "@langwatch/clickhouse";
import {
  definePipeline,
  type GroupKey,
  type Metrics,
  type PipelineChainWithId,
  renderGroupKey,
} from "@langwatch/event-sourcing";
import type { CancellationPublisher } from "~/server/scenarios/cancellation-channel";
import { publishCancellation } from "~/server/scenarios/cancellation-channel";
import { cancelRun } from "./cancelRun.command";
import { deleteRun } from "./deleteRun.command";
import { endTextMessage } from "./endTextMessage.command";
import {
  SIMULATION_RUN_PIPELINE_NAME,
  SIMULATION_RUN_PIPELINE_PREFIX,
  simulationRunEvents,
} from "./events";
import { finishRun } from "./finishRun.command";
import {
  mapMessageSnapshot,
  mapTextMessageEnd,
  type SimulationMessageRecord,
  simulationMessageRecordSchema,
} from "./messages";
import { queueRun } from "./queueRun.command";
import { recordMetrics } from "./recordMetrics.command";
import {
  computeRunMetricsIntents,
  initRunMetricsState,
  RUN_METRICS_PROCESS_NAME,
  type RunMetricsDispatchDeps,
  runMetricsOn,
  runMetricsOnWake,
  runMetricsStateSchema,
} from "./runMetrics.process";
import {
  initScenarioExecutionState,
  SCENARIO_EXECUTION_PROCESS_NAME,
  type ScenarioExecutionDispatchDeps,
  scenarioExecutionIntents,
  scenarioExecutionOn,
  scenarioExecutionOnWake,
  scenarioExecutionStateSchema,
} from "./scenarioExecution.process";
import {
  initSimulationRunState,
  type SimulationRunState,
  simulationRunStateSchema,
} from "./schema";
import {
  applyCancelRequested,
  applyDeleted,
  applyFinished,
  applyMessageSnapshot,
  applyMetricsRecorded,
  applyQueued,
  applyStarted,
  applyTextMessageEnd,
  applyTextMessageStart,
} from "./simulationRunState.projection";
import { snapshotMessages } from "./snapshotMessages.command";
import { startRun } from "./startRun.command";
import { startTextMessage } from "./startTextMessage.command";
import { simulationRunMessagesTable, simulationRunsTable } from "./table";

const FOLD_PROJECTION_NAME = "simulationRunState";
const MAP_PROJECTION_NAME = "simulationRunMessages";
const DEFAULT_RETENTION_DAYS = 308;

/**
 * ADR-105 decision 9 — `simulation_runs` has rows in production stamped under
 * this date. Pinning it keeps the fold's version gate passing for every one
 * of them; without a pin, adopting the derived hash would fail every live
 * row's gate on deploy, since no stored stamp matches a freshly computed hash.
 */
const SIMULATION_RUN_STATE_VERSION = "2026-02-01";

/**
 * The fold's lane, keyed on `scenarioRunId` alone (ADR-100). A lane shared by
 * two runs races their read-modify-write cycles and loses an update no
 * read-time dedup recovers, so a fold's scope is always the aggregate — the
 * signature has nowhere to pass a batch or set id.
 */
export function simulationRunFoldGroupKey(args: {
  readonly tenantId: string;
  readonly scenarioRunId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: FOLD_PROJECTION_NAME },
    scope: {
      kind: "aggregate",
      aggregateType: SIMULATION_RUN_PIPELINE_NAME,
      aggregateId: args.scenarioRunId,
    },
  };
}

export function renderSimulationRunFoldGroupKey(args: {
  readonly tenantId: string;
  readonly scenarioRunId: string;
}): string {
  return renderGroupKey(simulationRunFoldGroupKey(args));
}

const derivedRunMapping = deriveRowMapping<
  SimulationRunState,
  typeof simulationRunsTable.columns
>({
  table: simulationRunsTable,
  state: simulationRunStateSchema,
  key: "ScenarioRunId",
  tenant: "TenantId",
  stateVersionColumn: "Version",
  fill: { ProjectionId: (state) => state.scenarioRunId },
});

/**
 * `StartedAt` is the partition anchor, so it is stamped once and read back on
 * every subsequent fold — never re-derived, and never null, which the
 * deployed column does not allow.
 */
const runRowMapping: RowMapping<
  SimulationRunState,
  typeof simulationRunsTable.columns
> = {
  toRow: (state, context) => {
    const row = derivedRunMapping.toRow(state, context);
    return state.startedAt === null
      ? { ...row, StartedAt: context.writtenAt }
      : row;
  },
  fromRow: derivedRunMapping.fromRow,
};

const messageRowMapping = deriveAppendMapping<
  SimulationMessageRecord,
  typeof simulationRunMessagesTable.columns
>({
  table: simulationRunMessagesTable,
  record: simulationMessageRecordSchema,
  fill: {
    TenantId: (_record, context) => context.tenantId,
    AcceptedAt: () => new Date(),
    UpdatedAt: () => new Date(),
    _retention_days: (_record, context) =>
      context.retentionDays ?? DEFAULT_RETENTION_DAYS,
  },
});

export interface SimulationBroadcastPorts {
  broadcastToTenant(
    tenantId: string,
    payload: string,
    eventType: string,
  ): Promise<void>;
}

export interface SimulationProcessingPipelineDeps {
  readonly client: ClickHouseClient;
  readonly cache?: FoldStateCache<SimulationRunState>;
  readonly metrics?: Metrics;
  /** Absent means a queued run is never dispatched, and a dead run never
   * reaches a terminal STALLED state. */
  readonly scenarioExecution?: ScenarioExecutionDispatchDeps;
  /** Absent means a finished run's cost and latency are never measured. */
  readonly runMetrics?: RunMetricsDispatchDeps;
  readonly billingPoke?: { handle(event: { tenantId: string }): Promise<void> };
  readonly broadcast?: SimulationBroadcastPorts;
  readonly cancellationPublisher?: CancellationPublisher;
}

type SimulationChain = PipelineChainWithId<
  typeof SIMULATION_RUN_PIPELINE_NAME,
  typeof SIMULATION_RUN_PIPELINE_PREFIX,
  typeof simulationRunEvents
>;

function mountProcessManagers(
  chain: SimulationChain,
  deps: SimulationProcessingPipelineDeps,
): SimulationChain {
  let next = chain;
  if (deps.scenarioExecution) {
    next = next.withProcessManager(SCENARIO_EXECUTION_PROCESS_NAME, {
      state: scenarioExecutionStateSchema,
      init: initScenarioExecutionState,
      intents: scenarioExecutionIntents(deps.scenarioExecution),
      on: scenarioExecutionOn,
      onWake: scenarioExecutionOnWake,
    });
  }
  if (deps.runMetrics) {
    next = next.withProcessManager(RUN_METRICS_PROCESS_NAME, {
      state: runMetricsStateSchema,
      init: initRunMetricsState,
      intents: computeRunMetricsIntents(deps.runMetrics),
      on: runMetricsOn,
      onWake: runMetricsOnWake,
    });
  }
  return next;
}

/** `snapshotUpdateBroadcast` fires on everything but `textMessageStart`
 * (the API route streams those frames itself); `cancellationBroadcast` fires
 * only on `cancelRequested`, rethrowing so a failed publish is retried rather
 * than leaving a child process running unattended. */
function mountBroadcastSubscribers(
  chain: SimulationChain,
  deps: SimulationProcessingPipelineDeps,
): SimulationChain {
  let next = chain;
  if (deps.broadcast) {
    const broadcast = deps.broadcast;
    const nudge = (
      tenantId: string,
      data: { batchRunId?: string; scenarioSetId?: string },
      scenarioRunId: string,
    ) =>
      broadcast.broadcastToTenant(
        tenantId,
        JSON.stringify({
          event: "simulation_updated",
          scenarioRunId,
          batchRunId: data.batchRunId,
          scenarioSetId: data.scenarioSetId,
        }),
        "simulation_updated",
      );
    next = next.withSubscriber("snapshotUpdateBroadcast", {
      on: {
        queued: (data, ctx) => nudge(ctx.tenantId, data, data.scenarioRunId),
        started: (data, ctx) => nudge(ctx.tenantId, data, data.scenarioRunId),
        messageSnapshot: (data, ctx) =>
          nudge(ctx.tenantId, {}, data.scenarioRunId),
        // textMessageStart deliberately absent — the API route streams those
        // frames itself, and a refetch nudge on the same instant empties the
        // accumulated content before the fold has caught up.
        textMessageEnd: (data, ctx) =>
          nudge(ctx.tenantId, {}, data.scenarioRunId),
        finished: (data, ctx) => nudge(ctx.tenantId, {}, data.scenarioRunId),
        metricsRecorded: (data, ctx) =>
          nudge(ctx.tenantId, {}, data.scenarioRunId),
        cancelRequested: (data, ctx) =>
          nudge(ctx.tenantId, {}, data.scenarioRunId),
        deleted: (data, ctx) => nudge(ctx.tenantId, {}, data.scenarioRunId),
      },
    });
  }
  if (deps.cancellationPublisher) {
    const publisher = deps.cancellationPublisher;
    next = next.withSubscriber("cancellationBroadcast", {
      on: {
        // Rethrows on a failed publish (unlike the SSE nudges above): losing
        // this one leaves a child process running against a run the user
        // asked to stop.
        cancelRequested: (data) =>
          publishCancellation({
            publisher,
            message: { scenarioRunId: data.scenarioRunId },
          }),
      },
    });
  }
  return next;
}

/**
 * Mounts the run's fold and its item-row map, each beside the store it writes
 * to. The run's messages are item rows and its batch totals a query
 * (`batchAggregates.ts`), so nothing in the fold grows with the work
 * (ADR-103).
 */
function buildStores(deps: SimulationProcessingPipelineDeps) {
  const runStore = clickhouseReplacing({
    client: deps.client,
    table: simulationRunsTable,
    version: SIMULATION_RUN_STATE_VERSION,
    key: "ScenarioRunId",
    stateVersionColumn: "Version",
    row: runRowMapping,
    cache: deps.cache ?? noFoldStateCache<SimulationRunState>(),
  });

  const messagesStore = clickhouseAppend<
    SimulationMessageRecord,
    typeof simulationRunMessagesTable.columns
  >({
    client: deps.client,
    table: simulationRunMessagesTable,
    toRow: messageRowMapping,
  });

  return { runStore, messagesStore };
}

export function createSimulationProcessingPipeline(
  deps: SimulationProcessingPipelineDeps,
) {
  const { runStore, messagesStore } = buildStores(deps);

  let chain = definePipeline(SIMULATION_RUN_PIPELINE_NAME)
    .prefix(SIMULATION_RUN_PIPELINE_PREFIX)
    .events(simulationRunEvents)
    .id({
      queued: (data) => data.scenarioRunId,
      started: (data) => data.scenarioRunId,
      messageSnapshot: (data) => data.scenarioRunId,
      textMessageStart: (data) => data.scenarioRunId,
      textMessageEnd: (data) => data.scenarioRunId,
      finished: (data) => data.scenarioRunId,
      metricsRecorded: (data) => data.scenarioRunId,
      cancelRequested: (data) => data.scenarioRunId,
      deleted: (data) => data.scenarioRunId,
    })
    .withCommand("queueRun", {
      input: simulationRunEvents.queued,
      handle: queueRun,
    })
    .withCommand("startRun", {
      input: simulationRunEvents.started,
      handle: startRun,
    })
    .withCommand("snapshotMessages", {
      input: simulationRunEvents.messageSnapshot,
      handle: snapshotMessages,
    })
    .withCommand("startTextMessage", {
      input: simulationRunEvents.textMessageStart,
      handle: startTextMessage,
    })
    .withCommand("endTextMessage", {
      input: simulationRunEvents.textMessageEnd,
      handle: endTextMessage,
    })
    .withCommand("finishRun", {
      input: simulationRunEvents.finished,
      handle: finishRun,
    })
    .withCommand("recordMetrics", {
      input: simulationRunEvents.metricsRecorded,
      handle: recordMetrics,
    })
    .withCommand("cancelRun", {
      input: simulationRunEvents.cancelRequested,
      handle: cancelRun,
    })
    .withCommand("deleteRun", {
      input: simulationRunEvents.deleted,
      handle: deleteRun,
    })
    .withFold(FOLD_PROJECTION_NAME, {
      state: simulationRunStateSchema,
      init: initSimulationRunState,
      pin: SIMULATION_RUN_STATE_VERSION,
      on: {
        queued: applyQueued,
        started: applyStarted,
        messageSnapshot: applyMessageSnapshot,
        textMessageStart: applyTextMessageStart,
        textMessageEnd: applyTextMessageEnd,
        finished: applyFinished,
        metricsRecorded: applyMetricsRecorded,
        cancelRequested: applyCancelRequested,
        deleted: applyDeleted,
      },
      store: runStore,
    })
    .withMap(MAP_PROJECTION_NAME, {
      on: {
        messageSnapshot: mapMessageSnapshot,
        textMessageEnd: mapTextMessageEnd,
      },
      store: messagesStore,
    });

  chain = mountProcessManagers(chain, deps);
  chain = mountBroadcastSubscribers(chain, deps);

  if (deps.billingPoke) {
    const billingPoke = deps.billingPoke;
    chain = chain.withSubscriber("billingMeterPoke", {
      on: {
        started: (_data, ctx) => billingPoke.handle({ tenantId: ctx.tenantId }),
        messageSnapshot: (_data, ctx) =>
          billingPoke.handle({ tenantId: ctx.tenantId }),
      },
    });
  }

  return chain.build({ metrics: deps.metrics });
}
