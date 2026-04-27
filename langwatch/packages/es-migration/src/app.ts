import { Client as ElasticClient } from "@elastic/elasticsearch";
import { createClient as createClickHouseClient } from "@clickhouse/client";

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient.js";

import { EventSourcing } from "~/server/event-sourcing/eventSourcing.js";
import { mapCommands } from "~/server/event-sourcing/mapCommands.js";
import { RepositoryFoldStore } from "~/server/event-sourcing/projections/repositoryFoldStore.js";
import type { ReactorDefinition } from "~/server/event-sourcing/reactors/reactor.types.js";

// Simulation pipeline
import { createSimulationProcessingPipeline } from "~/server/event-sourcing/pipelines/simulation-processing/pipeline.js";
import { SimulationRunStateRepositoryClickHouse } from "~/server/event-sourcing/pipelines/simulation-processing/repositories/index.js";
import type { SimulationRunStateData } from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationRunState.foldProjection.js";
import type { SimulationProcessingEvent } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/events.js";
import { SIMULATION_PROJECTION_VERSIONS } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/constants.js";
import { ComputeRunMetricsCommand } from "~/server/event-sourcing/pipelines/simulation-processing/commands/computeRunMetrics.command.js";
import { createSnapshotUpdateBroadcastReactor } from "~/server/event-sourcing/pipelines/simulation-processing/reactors/snapshotUpdateBroadcast.js";
import { createSuiteRunSyncReactor } from "~/server/event-sourcing/pipelines/simulation-processing/reactors/suiteRunSync.reactor.js";

// Suite run pipeline
import { createSuiteRunProcessingPipeline } from "~/server/event-sourcing/pipelines/suite-run-processing/pipeline.js";
import { SuiteRunStateRepositoryClickHouse } from "~/server/event-sourcing/pipelines/suite-run-processing/repositories/index.js";
import { SUITE_RUN_PROJECTION_VERSIONS } from "~/server/event-sourcing/pipelines/suite-run-processing/schemas/constants.js";

// Experiment run pipeline
import { createExperimentRunProcessingPipeline } from "~/server/event-sourcing/pipelines/experiment-run-processing/pipeline.js";
import { ExperimentRunStateRepositoryClickHouse } from "~/server/event-sourcing/pipelines/experiment-run-processing/repositories/index.js";
import { createExperimentRunStateFoldStore } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentRunState.store.js";
import { createExperimentRunItemAppendStore } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentRunResultStorage.store.js";
import type { ExperimentRunStateData } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentRunState.foldProjection.js";
import type { ClickHouseExperimentRunResultRecord } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentRunResultStorage.mapProjection.js";

import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service.js";
import type { EventSourcingService } from "~/server/event-sourcing/services/eventSourcingService.js";

// Trace pipeline stores
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository.js";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository.js";
import { TraceSummaryStore } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.store.js";
import { SpanAppendStore } from "~/server/event-sourcing/pipelines/trace-processing/projections/spanStorage.store.js";
import type { TraceSummaryData } from "~/server/app-layer/traces/types.js";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types.js";
import type { AppendStore } from "~/server/event-sourcing/projections/mapProjection.types.js";

// Evaluation pipeline stores
import { EvaluationRunClickHouseRepository } from "~/server/app-layer/evaluations/repositories/evaluation-run.clickhouse.repository.js";
import { EvaluationRunStore } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationRun.store.js";
// DSPy step repository (direct-write for dspy-steps migration)
import { DspyStepClickHouseRepository } from "~/server/app-layer/dspy-steps/repositories/dspy-step.clickhouse.repository.js";

// Event repository (for direct-write bulk inserts)
import { EventRepositoryClickHouse } from "~/server/event-sourcing/stores/repositories/eventRepositoryClickHouse.js";
import type { EventRecord } from "~/server/event-sourcing/stores/repositories/eventRepository.types.js";

import { loadConfig } from "./config.js";
import { PortForward } from "./portForward.js";
import { createBatchingClickHouseClient } from "./lib/batchingClickHouseClient.js";
import type { Logger, MigrationConfig } from "./lib/types.js";

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

function createConsoleLogger(): Logger {
  const minLevel: LogLevel =
    (process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined) ?? "info";
  const threshold = LOG_LEVELS[minLevel] ?? LOG_LEVELS.info;

  const fmt = (level: LogLevel, msg: string, ctx?: Record<string, unknown>) => {
    if (LOG_LEVELS[level] < threshold) return;
    const ts = new Date().toISOString();
    const extra = ctx ? ` ${JSON.stringify(ctx)}` : "";
    process.stderr.write(`[${ts}] ${level.toUpperCase()} ${msg}${extra}\n`);
  };
  return {
    info: (msg, ctx) => fmt("info", msg, ctx),
    warn: (msg, ctx) => fmt("warn", msg, ctx),
    error: (msg, ctx) => fmt("error", msg, ctx),
    debug: (msg, ctx) => fmt("debug", msg, ctx),
  };
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

/** No-op broadcast service — migration doesn't need SSE broadcasting. */
const noopBroadcast: BroadcastService = {
  broadcastToTenant: async () => {},
  getListenerCount: () => 0,
  getTotalListenerCount: () => 0,
  getTenantEmitter: () => {
    throw new Error("Not implemented — migration does not broadcast");
  },
  cleanupTenantEmitter: () => {},
  getActiveTenants: () => [],
  close: async () => {},
} as unknown as BroadcastService;

/**
 * No-op reactor factory. The migration goes direct-write for every aggregate
 * type, so reactors never actually fire — but the pipeline type signatures
 * require them to exist. Give each stub a unique, descriptive name so any
 * future regression that accidentally dispatches through the reactor path is
 * obvious in logs.
 */
function noopReactor<E, S>(name: string): ReactorDefinition<any, any> {
  return {
    name,
    handle: async () => {},
  } as unknown as ReactorDefinition<any, any>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AppDependencies {
  config: MigrationConfig;
  logger: Logger;
  esClient: ElasticClient;
  /** Raw (unbatched) ClickHouse client — use for existence checks and direct writes. */
  clickhouse: ReturnType<typeof createClickHouseClient>;
  simulationService: EventSourcingService<any, any>;
  evaluationService: EventSourcingService<any, any>;
  /** Simulation run fold store (for direct-write simulation migration). */
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
  /** Trace summary fold store (for direct-write trace migration). */
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** Span append store (for direct-write trace migration). */
  spanAppendStore: SpanAppendStore;
  /** Evaluation run store (for direct-write trace-evaluation migration). */
  evaluationRunStore: EvaluationRunStore;
  /** Experiment run state fold store (for direct-write batch-evaluations migration). */
  experimentRunStateFoldStore: FoldProjectionStore<ExperimentRunStateData>;
  /** Experiment run item append store (for direct-write batch-evaluations migration). */
  experimentRunItemAppendStore: AppendStore<ClickHouseExperimentRunResultRecord>;
  /** DSPy step repository (for direct-write dspy-steps migration). */
  dspyStepRepository: DspyStepClickHouseRepository;
  /** Bulk-insert event records directly to event_log (for direct-write migrations). */
  insertEventRecords(records: EventRecord[]): Promise<void>;
  /** Flush buffered ClickHouse inserts — call at batch boundaries. */
  flushClickHouse(): Promise<void>;
  close(): Promise<void>;
}

export async function createApp(
  configOverrides?: Partial<MigrationConfig>,
): Promise<AppDependencies> {
  const config = loadConfig(configOverrides);
  const logger = createConsoleLogger();

  // --- Elasticsearch (source) ---
  const esNodeUrl = requireEnv("ELASTICSEARCH_NODE_URL");
  const esApiKey = process.env.ELASTICSEARCH_API_KEY;
  const esClient = new ElasticClient({
    node: esNodeUrl,
    ...(esApiKey ? { auth: { apiKey: esApiKey } } : {}),
  });

  // --- ClickHouse (event store target) ---
  const chFlushSize = parseInt(process.env.CH_BATCH_SIZE ?? "5000", 10);
  const rawClickhouse = createClickHouseClient({
    url: new URL(requireEnv("CLICKHOUSE_URL")),
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  const { client: clickhouse, flush: flushClickHouse } =
    createBatchingClickHouseClient(rawClickhouse, chFlushSize);
  logger.info("ClickHouse batching enabled", { flushSize: chFlushSize });

  // Every app-layer + event-sourcing repository now takes a
  // ClickHouseClientResolver (tenantId -> client). The migration runs against
  // a single ClickHouse instance, so tenantId is irrelevant — we just return
  // the appropriate client (batching for writes, raw for read-after-write).
  const resolveBatching: ClickHouseClientResolver = async () => clickhouse;
  const resolveRaw: ClickHouseClientResolver = async () => rawClickhouse;

  // --- ES port-forward (optional, for kubectl-based access) ---
  let portForward: PortForward | null = null;
  const usePortForward =
    (process.env.ES_PORT_FORWARD ?? "").toLowerCase() === "true";
  if (usePortForward) {
    const localPort = parseInt(
      process.env.ES_PORT_FORWARD_LOCAL_PORT ?? "9200",
      10,
    );
    const remotePort = parseInt(
      process.env.ES_PORT_FORWARD_REMOTE_PORT ?? "9200",
      10,
    );
    const service =
      process.env.ES_PORT_FORWARD_SERVICE ?? "svc/elasticsearch";
    const namespace = process.env.ES_PORT_FORWARD_NAMESPACE;

    portForward = new PortForward({
      service,
      localPort,
      remotePort,
      namespace,
      logger,
    });
    // Identity check: after the tunnel is reachable, verify we're actually
    // talking to Elasticsearch — not some unrelated local service that
    // happened to be bound to this port.
    await portForward.start({
      identityCheck: async () => {
        await esClient.ping();
      },
    });
  }

  // --- Event Sourcing (migration mode — no Redis, no BullMQ) ---
  // Use batching client for event store (append-only, no read-after-write needed).
  // Use raw client for projection stores (fold projections need read-after-write
  // consistency: store() must be visible to the next get() call).
  const eventSourcing = new EventSourcing({
    clickhouse: resolveBatching,
    redis: undefined,
    processRole: "migration",
  });

  // --- Trace pipeline stores (constructed early so ComputeRunMetricsCommand
  // below can reference traceSummaryStore). Use batching client — writes are
  // buffered and flushed at batch boundaries. ---
  const traceSummaryRepo = new TraceSummaryClickHouseRepository(resolveBatching);
  const traceSummaryStore = new TraceSummaryStore(traceSummaryRepo);
  const spanStorageRepo = new SpanStorageClickHouseRepository(resolveBatching);
  const spanAppendStore = new SpanAppendStore(spanStorageRepo);

  // --- Suite run pipeline ---
  const suiteRunRepository = new SuiteRunStateRepositoryClickHouse(resolveRaw);
  const suiteRunPipeline = eventSourcing.register(
    createSuiteRunProcessingPipeline({
      suiteRunStateFoldStore: new RepositoryFoldStore(
        suiteRunRepository,
        SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE,
      ),
    }),
  );

  // --- Simulation pipeline ---
  // Everything except `snapshotUpdateBroadcastReactor`, `suiteRunSyncReactor`,
  // and `computeRunMetricsCommand` is a no-op stub: the simulations target
  // uses direct-write via `processAggregate`, so reactors never fire during
  // migration. The stubs exist purely to satisfy the pipeline type signature.
  const simRepository = new SimulationRunStateRepositoryClickHouse(resolveRaw);
  const simulationRunStore = new RepositoryFoldStore<SimulationRunStateData>(
    simRepository,
    SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
  );
  const snapshotUpdateBroadcastReactor = createSnapshotUpdateBroadcastReactor({
    broadcast: noopBroadcast,
    hasRedis: false,
  });
  const suiteRunCommands = mapCommands(suiteRunPipeline.commands);
  const suiteRunSyncReactor = createSuiteRunSyncReactor({
    recordSuiteRunItemStarted: suiteRunCommands.recordSuiteRunItemStarted,
    completeSuiteRunItem: suiteRunCommands.completeSuiteRunItem,
  });
  const computeRunMetricsCommand = new ComputeRunMetricsCommand({
    traceSummaryStore,
    scheduleRetry: async () => {
      // No-op: migration writes historical data — there are no live
      // "not-yet-arrived" traces to schedule retries for.
    },
  });

  const simulationPipeline = eventSourcing.register(
    createSimulationProcessingPipeline({
      simulationRunStore,
      snapshotUpdateBroadcastReactor,
      cancellationBroadcastReactor: noopReactor<
        SimulationProcessingEvent,
        SimulationRunStateData
      >("migration-noop-cancellationBroadcast"),
      scenarioExecutionReactor: noopReactor<
        SimulationProcessingEvent,
        SimulationRunStateData
      >("migration-noop-scenarioExecution"),
      suiteRunSyncReactor,
      traceMetricsSyncReactor: noopReactor<
        SimulationProcessingEvent,
        SimulationRunStateData
      >("migration-noop-traceMetricsSync"),
      computeRunMetricsCommand,
    }),
  );

  // --- Experiment run pipeline ---
  const expRepository = new ExperimentRunStateRepositoryClickHouse(resolveRaw);
  const experimentRunStateFoldStore =
    createExperimentRunStateFoldStore(expRepository);
  const experimentRunItemAppendStore =
    createExperimentRunItemAppendStore(resolveRaw);

  const evaluationPipeline = eventSourcing.register(
    createExperimentRunProcessingPipeline({
      experimentRunStateFoldStore,
      experimentRunItemAppendStore,
      // No ES sync reactor — migration doesn't need it
    }),
  );

  // --- Simulation run store (direct-write, uses batching client for bulk writes) ---
  const simBatchingRepo = new SimulationRunStateRepositoryClickHouse(
    resolveBatching,
  );
  const simulationRunBatchingStore = new RepositoryFoldStore<SimulationRunStateData>(
    simBatchingRepo,
    SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
  );

  // --- Evaluation run store (direct-write for trace-evaluations migration) ---
  const evalRunRepo = new EvaluationRunClickHouseRepository(resolveBatching);
  const evaluationRunStore = new EvaluationRunStore(evalRunRepo);

  // --- Experiment run stores (direct-write for batch-evaluations migration) ---
  // Use batching client for bulk writes, flushed at batch boundaries.
  const expBatchingRepo = new ExperimentRunStateRepositoryClickHouse(
    resolveBatching,
  );
  const experimentRunStateBatchingStore = createExperimentRunStateFoldStore(
    expBatchingRepo,
  );
  const experimentRunItemBatchingStore = createExperimentRunItemAppendStore(
    resolveBatching,
  );

  // --- DSPy step repository (direct-write for dspy-steps migration) ---
  const dspyStepRepository = new DspyStepClickHouseRepository(resolveBatching);

  // --- Event repository (direct bulk-insert to event_log) ---
  const eventRepository = new EventRepositoryClickHouse(resolveBatching);
  const insertEventRecords = eventRepository.insertEventRecords.bind(eventRepository);

  return {
    config,
    logger,
    esClient,
    clickhouse: rawClickhouse,
    simulationService: simulationPipeline.service,
    evaluationService: evaluationPipeline.service,
    simulationRunStore: simulationRunBatchingStore,
    traceSummaryStore,
    spanAppendStore,
    evaluationRunStore,
    experimentRunStateFoldStore: experimentRunStateBatchingStore,
    experimentRunItemAppendStore: experimentRunItemBatchingStore,
    dspyStepRepository,
    insertEventRecords,
    flushClickHouse,
    close: async () => {
      await flushClickHouse();
      await eventSourcing.close();
      await rawClickhouse.close();
      await esClient.close();
      if (portForward) await portForward.stop();
    },
  };
}
