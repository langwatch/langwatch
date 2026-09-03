import {
  Deferred,
  RedisCachedFoldStore,
  type CommandDispatcher,
  type EventStore,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import type { RedisConnection } from "@langwatch/redis-client";
import {
  ComputeRunMetricsCommand,
  FinishRunCommand,
  RedisCancellationPublisherAdapter,
  SIMULATION_RUN_EXECUTION_PROCESS_NAME,
  SimulationClickHouseAdapter,
  SimulationProcessingPipelineAdapter,
  SimulationRunMetricsStoreAdapter,
  SimulationExecutionPort,
  SimulationRunStateStoreAdapter,
  simulationRunExecutionPM,
  UnavailableCancellationPublisherAdapter,
} from "@langwatch/scenario-server";
import { ScenarioExecutionService } from "@langwatch/scenario-contract";
import type {
  ComputeRunMetricsCommandData,
  ScenarioExecutionJob,
  SimulationCancelRun,
  SimulationDeleteRun,
  SimulationFinishRun,
  SimulationMessageSnapshot,
  SimulationProcessingEvent,
  SimulationQueueRun,
  SimulationStartRun,
  SimulationTextMessageEnd,
  SimulationTextMessageStart,
} from "@langwatch/scenario-contract";
import type { TenantBroadcastPort } from "@langwatch/notification-server";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  ClickHouseTraceDerivationSpanReaderAdapter,
  ModelCatalogTraceModelCostAdapter,
  ScenarioRoleMetricsDerivationService,
  SpanCostService,
} from "@langwatch/trace-server";
import type { SimulationRunStateData } from "@langwatch/scenario-server";
import type { ScenarioWorkerCapability } from "../features/scenario/scenario-worker-feature.installer";

/**
 * Reports the composition decision the simulation pipeline would otherwise
 * hide.
 *
 * The `execute` intent is the one place a queued run turns into a running one,
 * and a process without an execution pool refuses it into the outbox rather
 * than dropping it. That refusal is correct and invisible: the run sits at
 * `queued`, the outbox retries, and the stall wake eventually finishes it as an
 * error. A deployment should read that at boot rather than infer it from runs
 * that never start.
 */
export abstract class WorkerScenarioAbsenceReportPort {
  abstract withoutExecutionPool(): void;
}

export type WorkerScenarioCompositionInput = Readonly<{
  resolveClickHouseClient: EventingClickHouseClientResolver;
  /** The number the event store already stamps its own rows with. */
  defaultRetentionDays: number;
  /** The queue's own Redis: the run-state fold cache and cancellations share it. */
  redis?: RedisConnection | null;
  /** `LANGWATCH_FOLD_CACHE_TTL_SECONDS`, read once by the process. */
  foldCacheTtlSeconds?: number;
  /** The trace summary fold this process already composes; metrics read it. */
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** This process's own event store, for the finish command's ECST backfill. */
  eventStore: EventStore;
  /** The one tenant publisher this process holds; absent without Redis. */
  broadcast?: TenantBroadcastPort;
  /** Suite's own two commands, as the installer publishes them before install. */
  suiteRuns: {
    recordSuiteRunItemStarted: CommandDispatcher<Record<string, unknown>>;
    completeSuiteRunItem: CommandDispatcher<Record<string, unknown>>;
  };
  absence?: WorkerScenarioAbsenceReportPort;
}>;

/**
 * The simulation-run pipeline, composed and mounted in this process out of
 * packages alone.
 *
 * ALL SIXTEEN ROUTING KEYS. Nine commands, the run-state fold, the metrics map
 * projection, three live subscribers, the run-execution process manager and the
 * deferred metrics retry the installer registers beside the pipeline. A
 * definition short of one key is not a smaller deployment: the queue rejects an
 * unroutable job for redelivery rather than dropping it.
 *
 *     SimulationProcessingPipelineAdapter
 *       |- SimulationRunStateStoreAdapter    ClickHouse, behind the shared
 *       |                                    `simulation_runs` fold cache
 *       |- SimulationRunMetricsStoreAdapter  ClickHouse
 *       |- FinishRunCommand                  ECST backfill off this process's
 *       |                                    own event store
 *       |- ComputeRunMetricsCommand          the trace summary fold, the
 *       |                                    retry job, and the per-role
 *       |                                    derivation over stored spans
 *       |- simulationRunExecutionPM          cancel and finish are real;
 *       |                                    execute is a named absence
 *       |- snapshotUpdateBroadcast           the shared tenant publisher
 *       |- suiteRunSync                      Suite's own two commands
 *       `- traceMetricsSync                  this pipeline's own command
 *
 * THE FOLD CACHE PREFIX IS A WIRE CONTRACT. `simulation_runs` is a literal
 * here for the reason the trace prefixes are: while both graphs fold, a prefix
 * spelled differently would not fail — it would give this process its own empty
 * cache, and the two would stop seeing each other's applied-event-id sets, so a
 * redelivered batch could be folded twice.
 *
 * THE PER-ROLE DERIVATION PRICES FROM THE STATIC CATALOG, deliberately. A
 * stored span's cost was already decided at record time against the operator's
 * own rules; re-pricing it here against those rules would produce a second
 * answer to a question already billed. The catalog is the same one the trace
 * fold uses for its own cost, so the two agree by construction.
 */
export function createWorkerScenarioProcessing(
  options: WorkerScenarioCompositionInput,
): ScenarioWorkerCapability<ComputeRunMetricsCommandData, SimulationProcessingEvent> {
  const scheduleRetry = new Deferred<(payload: ComputeRunMetricsCommandData) => Promise<void>>(
    "scenario.scheduleComputeRunMetricsRetry",
  );
  const selfComputeRunMetrics = new Deferred<CommandDispatcher<ComputeRunMetricsCommandData>>(
    "scenario.selfComputeRunMetrics",
  );
  const execution = new WorkerSimulationExecutionAdapter();

  const derivation = ScenarioRoleMetricsDerivationService.create({
    spans: ClickHouseTraceDerivationSpanReaderAdapter.create({
      resolveClient: options.resolveClickHouseClient as never,
    }),
    spanCosts: SpanCostService.create({ modelCosts: ModelCatalogTraceModelCostAdapter.create() }),
  });

  options.absence?.withoutExecutionPool();

  const definition = () =>
    SimulationProcessingPipelineAdapter.create({
      simulationRunStore: cachedRunStore(options),
      simulationRunMetricsStore: SimulationRunMetricsStoreAdapter.create({
        type: "clickhouse",
        resolveClient: options.resolveClickHouseClient as never,
      }),
      finishRunCommand: new FinishRunCommand({
        loadPriorEvents: ({ tenantId, scenarioRunId }) =>
          options.eventStore.getEvents(
            scenarioRunId,
            { tenantId: createTenantId(tenantId) },
            "simulation_run",
          ) as Promise<SimulationProcessingEvent[]>,
      }),
      computeRunMetricsCommand: new ComputeRunMetricsCommand({
        traceSummaryStore: options.traceSummaryStore,
        scheduleRetry: scheduleRetry.fn,
        deriveScenarioRoleMetrics: (params) => derivation.derive(params),
      }),
      scenarioRunExecution: {
        name: SIMULATION_RUN_EXECUTION_PROCESS_NAME,
        process: simulationRunExecutionPM(
          new WorkerScenarioExecutionAdapter(
            options.redis
              ? RedisCancellationPublisherAdapter.create(options.redis)
              : UnavailableCancellationPublisherAdapter.create(),
          ),
          SimulationClickHouseAdapter.createNull({ execution }),
        ),
      },
      simulations: SimulationClickHouseAdapter.createNull({ execution }),
      snapshotUpdateBroadcast: {
        broadcastUpdate: async ({ tenantId, payload }) => {
          await options.broadcast?.broadcastToTenant({
            tenantId,
            event: payload,
            eventType: "simulation_updated",
          });
        },
      },
      suiteRunSync: {
        recordSuiteRunItemStarted: (data) =>
          options.suiteRuns.recordSuiteRunItemStarted(data as Record<string, unknown>),
        completeSuiteRunItem: (data) =>
          options.suiteRuns.completeSuiteRunItem(data as Record<string, unknown>),
      },
      traceMetricsSync: { computeRunMetrics: selfComputeRunMetrics.fn },
    });

  return {
    buildProcessing: definition,
    connect: (bindings) => {
      selfComputeRunMetrics.resolve(bindings.computeRunMetrics);
      scheduleRetry.resolve(bindings.scheduleComputeRunMetricsRetry);
      execution.connect(bindings.commands);
    },
  };
}

function cachedRunStore(
  options: WorkerScenarioCompositionInput,
): FoldProjectionStore<SimulationRunStateData> {
  const durable = SimulationRunStateStoreAdapter.create({
    type: "clickhouse",
    resolveClient: options.resolveClickHouseClient as never,
    defaultRetentionDays: options.defaultRetentionDays,
  }).createFoldStore();
  if (!options.redis) return durable;

  return new RedisCachedFoldStore<SimulationRunStateData>(durable, options.redis, {
    keyPrefix: "simulation_runs",
    ...(options.foldCacheTtlSeconds === undefined
      ? {}
      : { ttlSeconds: options.foldCacheTtlSeconds }),
  });
}

/**
 * How a simulation run reaches this pod's executor, and why it does not.
 *
 * `cancel` is real: it publishes on the same Redis channel a running child
 * listens on, so a cancel issued while another process holds the run still
 * stops it. `submit` REFUSES BY NAME, which is what the intent's own contract
 * asks for — a throw puts the run back on the outbox with backoff, so a run
 * queued while no executor is up is dispatched when one is, and the stall wake
 * is the backstop if none ever is.
 *
 * The refusal rather than a pool is the honest shape today, and the scope is
 * wider than this process: NO process in the repository composes
 * `ScenarioExecutionPoolService`. Two things are missing rather than parked
 * with a sibling. The pool spawns a scenario CHILD ENTRYPOINT that left the
 * tree with the platform application and has not been rebuilt anywhere. And
 * the prefetcher that feeds it takes eleven collaborators — agents, prompts,
 * suites, secrets, traces, workflows and projects among them — of which the
 * agent and prompt servers are not dependencies of this process at all. A pool
 * wired to a prefetcher that could not answer would fail every run at
 * execution time instead of at boot.
 *
 * The three prefetch methods are not reachable from the process manager at all;
 * they belong to the tRPC validation path, and they refuse by name so that a
 * caller that finds its way here gets a sentence rather than a null.
 */
class WorkerScenarioExecutionAdapter extends ScenarioExecutionService {
  constructor(private readonly cancellations: { publish(input: unknown): Promise<void> }) {
    super();
  }

  submit(input: ScenarioExecutionJob): Promise<never> {
    return Promise.reject(
      new Error(
        `No execution pool in this process; the outbox will retry execute for scenarioRunId=${input.scenarioRunId}`,
      ),
    );
  }

  async cancel(input: { projectId: string; scenarioRunId: string }): Promise<void> {
    await this.cancellations.publish(input);
  }

  prefetch(): Promise<never> {
    return Promise.reject(new Error("Scenario prefetch is not composed in this process."));
  }

  prepare(): never {
    throw new Error("Scenario preparation is not composed in this process.");
  }

  finishUnsuccessfulRun(): Promise<never> {
    return Promise.reject(new Error("Scenario failure handling is not composed in this process."));
  }
}

/**
 * The simulation write surface, as this pipeline's own commands.
 *
 * The run-execution process manager's `finish` intent asks `SimulationService`
 * to finish a run, and that call appends `finishRun` back into the very
 * pipeline the process manager is mounted on — so the sender only exists after
 * registration. Binding it through the installer's `connect` is what turns a
 * graph missing the command into a boot failure instead of a run that reaches
 * its end and never records it.
 */
class WorkerSimulationExecutionAdapter extends SimulationExecutionPort {
  private commands: Record<string, CommandDispatcher<unknown>> | undefined;

  connect(commands: Record<string, CommandDispatcher<unknown>>): void {
    this.commands = commands;
  }

  queueRun(input: SimulationQueueRun): Promise<void> {
    return this.dispatch("queueRun", input);
  }
  startRun(input: SimulationStartRun): Promise<void> {
    return this.dispatch("startRun", input);
  }
  messageSnapshot(input: SimulationMessageSnapshot): Promise<void> {
    return this.dispatch("messageSnapshot", input);
  }
  textMessageStart(input: SimulationTextMessageStart): Promise<void> {
    return this.dispatch("textMessageStart", input);
  }
  textMessageEnd(input: SimulationTextMessageEnd): Promise<void> {
    return this.dispatch("textMessageEnd", input);
  }
  finishRun(input: SimulationFinishRun): Promise<void> {
    return this.dispatch("finishRun", input);
  }
  cancelRun(input: SimulationCancelRun): Promise<void> {
    return this.dispatch("cancelRun", input);
  }
  deleteRun(input: SimulationDeleteRun): Promise<void> {
    return this.dispatch("deleteRun", input);
  }

  private async dispatch(name: string, input: unknown): Promise<void> {
    const command = this.commands?.[name];
    if (!command) {
      throw new Error(
        `Simulation pipeline has not registered its ${name} command; the run-execution process cannot append into a graph that is not mounted.`,
      );
    }
    await command(input);
  }
}
