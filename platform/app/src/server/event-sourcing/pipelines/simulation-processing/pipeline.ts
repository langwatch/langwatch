import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { CancellationPublisher } from "~/server/scenarios/cancellation-channel";
import { definePipeline } from "../../";
import type { CommandBus } from "../../commands/commandBus";
import type { ProcessManagerApplier } from "../../pipeline/processBuilder";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import { ReportUsageForMonthCommand } from "../billing-reporting/commands/reportUsageForMonth.command";
import { createBillingMeterPokeSubscriber } from "../billing-reporting/subscribers/billingMeterPoke.subscriber";
import {
  CancelRunCommand,
  DeleteRunCommand,
  FinishRunCommand,
  MessageSnapshotCommand,
  QueueRunCommand,
  StartRunCommand,
  TextMessageEndCommand,
  TextMessageStartCommand,
} from "./commands";
import {
  ComputeRunMetricsCommand,
  type ComputeRunMetricsDeps,
} from "./commands/computeRunMetrics.command";
import { runMetricsPM } from "./process-manager/runMetrics.process";
import { RUN_METRICS_PROCESS_NAME } from "./process-manager/runMetricsProcess.types";
import {
  buildProcessEventView,
  handleCancelRequested,
  handleMessageSnapshot,
  handleQueued,
  handleSettled,
  handleStarted,
  handleTextMessageEnd,
  handleTextMessageStart,
  scenarioExecutionWake,
} from "./process-manager/scenarioExecution.process";
import {
  createScenarioExecutionExecuteRunHandler,
  createScenarioExecutionFailRunHandler,
  type ScenarioExecutionDispatchDeps,
} from "./process-manager/scenarioExecutionIntentHandlers";
import {
  INITIAL_SCENARIO_EXECUTION_STATE,
  SCENARIO_EXECUTION_CONCURRENCY,
  SCENARIO_EXECUTION_INTENT_TYPES,
  SCENARIO_EXECUTION_LEASE_DURATION_MS,
  SCENARIO_EXECUTION_MAX_ATTEMPTS,
  SCENARIO_EXECUTION_PROCESS_NAME,
  scenarioExecutionExecuteRunIntentSchema,
  scenarioExecutionFailRunIntentSchema,
} from "./process-manager/scenarioExecutionProcess.types";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "./projections/simulationRunState.foldProjection";
import { SIMULATION_RUN_EVENT_TYPES } from "./schemas/constants";
import type { SimulationProcessingEvent } from "./schemas/events";
import { createCancellationBroadcastSubscriber } from "./subscribers/cancellationBroadcast.subscriber";
import { createSnapshotUpdateBroadcastSubscriber } from "./subscribers/snapshotUpdateBroadcast.subscriber";

/**
 * ADR-082 Rule 1 — nothing here is a value the builder registers. Every
 * subscriber, process manager and the one DI'd command are constructed in this
 * file from imported factories, so the topology is readable without the registry. The members are
 * wider than they were and all of them are inert: two fold stores, a broadcast
 * service, a publisher, two function ports, the command bus, and the process's
 * own dispatch bundle.
 */
export interface SimulationProcessingPipelineDeps {
  /** Redis-cached fold store for `simulationRunState`. */
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
  /**
   * The trace pipeline's summary fold, read by `computeRunMetrics`' pull path
   * when a trace's metrics were not carried on the command.
   */
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** SSE fan-out for the run drawer. */
  broadcast: BroadcastService;
  /** Redis pub/sub for cancellation; null when no Redis is configured. */
  cancellationPublisher: CancellationPublisher | null;
  /** Per-role cost/latency for a trace, derived from stored spans. */
  deriveScenarioRoleMetrics: ComputeRunMetricsDeps["deriveScenarioRoleMetrics"];
  /**
   * ADR-082 §5 — identity-keyed command dispatch. Used here for a *self*
   * reference: the `runMetrics` process dispatches `computeRunMetrics`, which
   * this same pipeline registers. Binding is eager, resolution is not, so the
   * pipeline being mid-construction carries no meaning.
   */
  commands: CommandBus;
  /** Usage reporting is SaaS-only; the poke is off everywhere else. */
  isSaas: boolean;
  /**
   * Dispatch and terminal-write dependencies for the `scenarioExecution`
   * process (ADR-073).
   */
  scenarioExecutionDispatch: ScenarioExecutionDispatchDeps;
}

/**
 * The `scenarioExecution` process-manager topology, exported standalone so
 * tests can build the exact definition the runtime mounts.
 *
 * `queued` enqueues the dispatch and arms a deadline; every progress event
 * re-arms it; the terminal events clear it; a fired wake writes the terminal
 * state itself. See ADR-073 and `scenarioExecution.process.ts`.
 *
 * The outbox is sized by the dispatch, not by the terminal write: the lease
 * has to outlast a whole child process, and `concurrency` is what bounds how
 * many children a worker holds — the job the pool's deleted `_pending` array
 * used to do.
 */
export function scenarioExecutionPM(
  dispatch: ScenarioExecutionDispatchDeps,
): ProcessManagerApplier<SimulationProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_SCENARIO_EXECUTION_STATE)
      .intent(
        SCENARIO_EXECUTION_INTENT_TYPES.EXECUTE_RUN,
        scenarioExecutionExecuteRunIntentSchema,
        createScenarioExecutionExecuteRunHandler(dispatch),
      )
      .intent(
        SCENARIO_EXECUTION_INTENT_TYPES.FAIL_RUN,
        scenarioExecutionFailRunIntentSchema,
        createScenarioExecutionFailRunHandler(dispatch),
      )
      .on(SIMULATION_RUN_EVENT_TYPES.QUEUED, handleQueued)
      .on(SIMULATION_RUN_EVENT_TYPES.STARTED, handleStarted)
      .on(SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT, handleMessageSnapshot)
      .on(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START, handleTextMessageStart)
      .on(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END, handleTextMessageEnd)
      .on(SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED, handleCancelRequested)
      .on(SIMULATION_RUN_EVENT_TYPES.FINISHED, handleSettled)
      .on(SIMULATION_RUN_EVENT_TYPES.DELETED, handleSettled)
      .onWake(scenarioExecutionWake)
      .toPayload(buildProcessEventView)
      .outbox({
        maxAttempts: SCENARIO_EXECUTION_MAX_ATTEMPTS,
        leaseDurationMs: SCENARIO_EXECUTION_LEASE_DURATION_MS,
        concurrency: SCENARIO_EXECUTION_CONCURRENCY,
        batchSize: SCENARIO_EXECUTION_CONCURRENCY,
      });
}

/**
 * Creates the simulation processing pipeline definition.
 *
 * This pipeline uses simulation_run aggregates (aggregateId = scenarioRunId).
 * It tracks the lifecycle of simulation runs:
 * - started -> message snapshots -> finished (or deleted)
 *
 * Fold Projection: simulationRunState
 * - Tracks simulation run state (status, messages, verdict, etc.)
 * - Stored in simulation_runs ClickHouse table
 *
 * Commands:
 * - startRun: Emits SimulationRunStartedEvent when run begins
 * - messageSnapshot: Emits SimulationMessageSnapshotEvent for message updates
 * - finishRun: Emits SimulationRunFinishedEvent when run completes
 * - deleteRun: Emits SimulationRunDeletedEvent for soft-delete
 * - computeRunMetrics: Computes cost/latency metrics from traces (ECST + pull)
 */
export function createSimulationProcessingPipeline(
  deps: SimulationProcessingPipelineDeps,
) {
  return (
    definePipeline<SimulationProcessingEvent>()
      .withName("simulation_processing")
      .withAggregateType("simulation_run")
      .withFoldProjection(
        "simulationRunState",
        new SimulationRunStateFoldProjection({
          store: deps.simulationRunStore,
        }),
      )
      .withEventSubscriber(
        "snapshotUpdateBroadcast",
        createSnapshotUpdateBroadcastSubscriber({
          broadcast: deps.broadcast,
        }),
      )
      .withEventSubscriber(
        "cancellationBroadcast",
        createCancellationBroadcastSubscriber({
          publisher: deps.cancellationPublisher,
        }),
      )
      // The two simulation events `orgBillableEventsMeter` records. Mounted here
      // rather than only on trace ingest because a simulation-only organization
      // has no other billable stream to poke from.
      .withEventSubscriber(
        "billingMeterPoke",
        createBillingMeterPokeSubscriber<SimulationProcessingEvent>({
          eventTypes: [
            SIMULATION_RUN_EVENT_TYPES.STARTED,
            SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
          ],
          reportUsageForMonth: deps.commands.port(ReportUsageForMonthCommand),
          isSaas: deps.isSaas,
        }),
      )
      .withCommand("queueRun", QueueRunCommand)
      .withCommand("startRun", StartRunCommand)
      .withCommand("messageSnapshot", MessageSnapshotCommand)
      .withCommand("textMessageStart", TextMessageStartCommand)
      .withCommand("textMessageEnd", TextMessageEndCommand)
      .withCommand("finishRun", FinishRunCommand)
      .withCommand("cancelRun", CancelRunCommand)
      .withCommand("deleteRun", DeleteRunCommand)
      .withCommandInstance(
        "computeRunMetrics",
        ComputeRunMetricsCommand,
        new ComputeRunMetricsCommand({
          simulationRunStore: deps.simulationRunStore,
          traceSummaryStore: deps.traceSummaryStore,
          deriveScenarioRoleMetrics: deps.deriveScenarioRoleMetrics,
        }),
      )
      .withProcessManager(
        SCENARIO_EXECUTION_PROCESS_NAME,
        scenarioExecutionPM(deps.scenarioExecutionDispatch),
      )
      // The run's metrics are measured after it settles, over all of its traces
      // at once — the durable deadline replaces the per-trace accumulator that
      // could never correct itself once a partial answer had been recorded. A
      // measurement that comes back empty re-arms a bounded number of times, so
      // cost that lands after the settle period is still recorded.
      .withProcessManager(
        RUN_METRICS_PROCESS_NAME,
        runMetricsPM({
          computeRunMetrics: deps.commands.port(ComputeRunMetricsCommand),
        }),
      )
      .build()
  );
}
