import { Client as ElasticClient } from "@elastic/elasticsearch";
import { createClient as createClickHouseClient } from "@clickhouse/client";

import { EventSourcing } from "~/server/event-sourcing/eventSourcing.js";
import { createSimulationProcessingPipeline } from "~/server/event-sourcing/pipelines/simulation-processing/pipeline.js";
import {
  SimulationRunStateRepositoryClickHouse,
} from "~/server/event-sourcing/pipelines/simulation-processing/repositories/index.js";
import { createSimulationRunStateFoldStore } from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationRunState.store.js";
import type { SimulationRunStateData } from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationRunState.foldProjection.js";
import { createSnapshotUpdateBroadcastReactor } from "~/server/event-sourcing/pipelines/simulation-processing/reactors/snapshotUpdateBroadcast.js";
import { createSuiteRunProcessingPipeline } from "~/server/event-sourcing/pipelines/suite-run-processing/pipeline.js";
import {
  SuiteRunStateRepositoryClickHouse,
} from "~/server/event-sourcing/pipelines/suite-run-processing/repositories/index.js";
import { createSuiteRunStateFoldStore } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteRunState.store.js";
import { createSuiteRunSyncReactor } from "~/server/event-sourcing/pipelines/simulation-processing/reactors/suiteRunSync.reactor.js";
import { mapCommands } from "~/server/event-sourcing/mapCommands.js";
import { createExperimentRunProcessingPipeline } from "~/server/event-sourcing/pipelines/experiment-run-processing/pipeline.js";
import {
  ExperimentRunStateRepositoryClickHouse,
} from "~/server/event-sourcing/pipelines/experiment-run-processing/repositories/index.js";
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
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types.js";

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
  /** Evaluation run fold store (for direct-write trace-evaluation migration). */
  evaluationRunStore: FoldProjectionStore<EvaluationRunData>;
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
    await portForward.start();
  }

  // --- Event Sourcing (migration mode — no Redis, no BullMQ) ---
  // Use batching client for event store (append-only, no read-after-write needed).
  // Use raw client for projection stores (fold projections need read-after-write
  // consistency: store() must be visible to the next get() call).
  const eventSourcing = new EventSourcing({
    clickhouse,
    redis: undefined,
    processRole: "migration",
  });

  // --- Suite run pipeline ---
  const suiteRunRepository = new SuiteRunStateRepositoryClickHouse(rawClickhouse);
  const suiteRunPipeline = eventSourcing.register(
    createSuiteRunProcessingPipeline({
      suiteRunStateFoldStore: createSuiteRunStateFoldStore(suiteRunRepository),
    }),
  );

  // --- Simulation pipeline ---
  const simRepository = new SimulationRunStateRepositoryClickHouse(rawClickhouse);
  const simulationRunStore = createSimulationRunStateFoldStore(simRepository);
  const snapshotUpdateBroadcastReactor = createSnapshotUpdateBroadcastReactor({
    broadcast: noopBroadcast,
    hasRedis: false,
  });
  const suiteRunCommands = mapCommands(suiteRunPipeline.commands);
  const suiteRunSyncReactor = createSuiteRunSyncReactor({
    recordSuiteRunItemStarted: suiteRunCommands.recordSuiteRunItemStarted,
    completeSuiteRunItem: suiteRunCommands.completeSuiteRunItem,
  });

  const simulationPipeline = eventSourcing.register(
    createSimulationProcessingPipeline({
      simulationRunStore,
      snapshotUpdateBroadcastReactor,
      suiteRunSyncReactor,
    }),
  );

  // --- Experiment run pipeline ---
  const expRepository = new ExperimentRunStateRepositoryClickHouse(rawClickhouse);
  const experimentRunStateFoldStore =
    createExperimentRunStateFoldStore(expRepository);
  const experimentRunItemAppendStore =
    createExperimentRunItemAppendStore(rawClickhouse);

  const evaluationPipeline = eventSourcing.register(
    createExperimentRunProcessingPipeline({
      experimentRunStateFoldStore,
      experimentRunItemAppendStore,
      // No ES sync reactor — migration doesn't need it
    }),
  );

  // --- Simulation run store (direct-write, uses batching client for bulk writes) ---
  const simBatchingRepo = new SimulationRunStateRepositoryClickHouse(clickhouse);
  const simulationRunBatchingStore = createSimulationRunStateFoldStore(simBatchingRepo);

  // --- Trace pipeline stores (direct-write, no pipeline registration needed) ---
  // Use batching client for all stores — writes are buffered and flushed at batch boundaries.
  const traceSummaryRepo = new TraceSummaryClickHouseRepository(clickhouse);
  const traceSummaryStore = new TraceSummaryStore(traceSummaryRepo);
  const spanStorageRepo = new SpanStorageClickHouseRepository(clickhouse);
  const spanAppendStore = new SpanAppendStore(spanStorageRepo);

  // --- Evaluation run store (direct-write for trace-evaluations migration) ---
  const evalRunRepo = new EvaluationRunClickHouseRepository(clickhouse);
  const evaluationRunStore = new EvaluationRunStore(evalRunRepo);

  // --- Experiment run stores (direct-write for batch-evaluations migration) ---
  // Use batching client for bulk writes, flushed at batch boundaries.
  const expBatchingRepo = new ExperimentRunStateRepositoryClickHouse(clickhouse);
  const experimentRunStateBatchingStore = createExperimentRunStateFoldStore(expBatchingRepo);
  const experimentRunItemBatchingStore = createExperimentRunItemAppendStore(clickhouse);

  // --- DSPy step repository (direct-write for dspy-steps migration) ---
  const dspyStepRepository = new DspyStepClickHouseRepository(clickhouse);

  // --- Event repository (direct bulk-insert to event_log) ---
  const eventRepository = new EventRepositoryClickHouse(clickhouse);
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
