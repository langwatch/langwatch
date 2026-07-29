import { definePipeline } from "../../";
import type { CommandBus } from "../../commands/commandBus";
import type { ProcessManagerApplier } from "../../pipeline/processBuilder";
import { CachedFoldStore } from "../../projections/cachedFoldStore";
import type { FoldCacheClient } from "../../projections/foldCache/foldCacheClient";
import type { AppendStore } from "../../projections/mapProjection.types";
import { ReportUsageForMonthCommand } from "../billing-reporting/commands/reportUsageForMonth.command";
import { createBillingMeterPokeSubscriber } from "../billing-reporting/subscribers/billingMeterPoke.subscriber";
import {
  CompleteExperimentRunCommand,
  RecordEvaluatorResultCommand,
  RecordTargetResultCommand,
  StartExperimentRunCommand,
} from "./commands";
import {
  buildProcessEventView,
  experimentRunExecutionWake,
  handleCompleted,
  handleEvaluatorResult,
  handleStarted,
  handleTargetResult,
} from "./process-manager/experimentRunExecution.process";
import {
  createExperimentRunExecutionFailRunHandler,
  type ExperimentRunExecutionDispatchDeps,
} from "./process-manager/experimentRunExecutionIntentHandlers";
import {
  EXPERIMENT_RUN_EXECUTION_INTENT_TYPES,
  EXPERIMENT_RUN_EXECUTION_LEASE_DURATION_MS,
  EXPERIMENT_RUN_EXECUTION_MAX_ATTEMPTS,
  EXPERIMENT_RUN_EXECUTION_PROCESS_NAME,
  experimentRunExecutionFailRunIntentSchema,
  INITIAL_EXPERIMENT_RUN_EXECUTION_STATE,
} from "./process-manager/experimentRunExecutionProcess.types";
import {
  type ClickHouseExperimentRunResultRecord,
  ExperimentRunResultStorageMapProjection,
} from "./projections/experimentRunResultStorage.mapProjection";
import {
  type ExperimentRunStateData,
  ExperimentRunStateFoldProjection,
} from "./projections/experimentRunState.foldProjection";
import { createExperimentRunStateFoldStore } from "./projections/experimentRunState.store";
import type { ExperimentRunStateRepository } from "./repositories/experimentRunState.repository";
import { EXPERIMENT_RUN_EVENT_TYPES } from "./schemas/constants";
import type { ExperimentRunProcessingEvent } from "./schemas/events";

/**
 * ADR-082 Rule 1 — the run-state store adapter and its cache tier are composed
 * here, from the repository they wrap. `experimentRunItemAppendStore` stays a
 * dep because it has no repository underneath it: it *is* the ClickHouse data
 * access for `experiment_run_items`, so it crosses as layer 2 rather than being
 * built from one.
 */
export interface ExperimentRunProcessingPipelineDeps {
  experimentRunStateRepository: ExperimentRunStateRepository;
  experimentRunItemAppendStore: AppendStore<ClickHouseExperimentRunResultRecord>;
  /** ADR-082 §3 — the resolved cache tier, never a redis client. */
  foldCacheClient: FoldCacheClient;
  /**
   * ADR-082 §5 — the reaper's terminal write is a command on THIS pipeline.
   * Self-dispatch needs no late binding: `port()` records the class and
   * resolves on first use, which is strictly after registration.
   */
  commands: CommandBus;
  /** Usage reporting is SaaS-only; the poke is off everywhere else. */
  isSaas: boolean;
  /**
   * The two effects the reaper needs that this pipeline does not own: stopping
   * work that may still be running, and marking the cached progress record.
   * Required-but-nullable (ADR-082 §6 hole 1) — where it is `null` runs have no
   * reaper, and every composition site has to say so on purpose rather than by
   * omission.
   */
  experimentRunExecutionEffects: Pick<
    ExperimentRunExecutionDispatchDeps,
    "signalStop" | "markRunFailed"
  > | null;
}

/**
 * The `experimentRunExecution` process-manager topology, exported standalone
 * so tests can build the exact definition the runtime mounts.
 *
 * Every result event re-arms the deadline; `completed` clears it; a fired wake
 * writes the terminal state itself. See ADR-073 and
 * `experimentRunExecution.process.ts`.
 */
export function experimentRunExecutionPM(
  dispatch: ExperimentRunExecutionDispatchDeps,
): ProcessManagerApplier<ExperimentRunProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_EXPERIMENT_RUN_EXECUTION_STATE)
      .intent(
        EXPERIMENT_RUN_EXECUTION_INTENT_TYPES.FAIL_RUN,
        experimentRunExecutionFailRunIntentSchema,
        createExperimentRunExecutionFailRunHandler(dispatch),
      )
      .on(EXPERIMENT_RUN_EVENT_TYPES.STARTED, handleStarted)
      .on(EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT, handleTargetResult)
      .on(EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT, handleEvaluatorResult)
      .on(EXPERIMENT_RUN_EVENT_TYPES.COMPLETED, handleCompleted)
      .onWake(experimentRunExecutionWake)
      .toPayload(buildProcessEventView)
      .outbox({
        maxAttempts: EXPERIMENT_RUN_EXECUTION_MAX_ATTEMPTS,
        leaseDurationMs: EXPERIMENT_RUN_EXECUTION_LEASE_DURATION_MS,
      });
}

/**
 * Creates the experiment run processing pipeline definition.
 *
 * This pipeline uses experiment_run aggregates (aggregateId = runId).
 * It tracks the lifecycle of experiment runs:
 * - started -> target results received -> evaluator results received -> completed
 *
 * Fold Projection: experimentRunState
 * - Computes progress and score statistics
 * - Stored in experiment_runs ClickHouse table
 * - Cost is NOT held here: it is summed from experiment_run_items at read
 *   time, and priced from the item's trace where the item carries no cost of
 *   its own. See ADR-072.
 *
 * Map Projection: experimentRunResultStorage
 * - Writes individual results to experiment_run_items for query-optimized access
 * - Enables efficient filtering/sorting of detailed results
 *
 * Commands:
 * - startExperimentRun: Emits ExperimentRunStartedEvent when run begins
 * - recordTargetResult: Emits TargetResultEvent per row/target
 * - recordEvaluatorResult: Emits EvaluatorResultEvent per row/evaluator
 * - completeExperimentRun: Emits ExperimentRunCompletedEvent when run finishes
 *
 * Process manager: experimentRunExecution (ADR-073)
 * - Liveness only. The run's own result events arm a durable deadline;
 *   completion clears it; a fired deadline writes the terminal state itself,
 *   so a run whose process disappears stops reading as in-flight forever.
 */
export function createExperimentRunProcessingPipeline(
  deps: ExperimentRunProcessingPipelineDeps,
) {
  const builder = definePipeline<ExperimentRunProcessingEvent>()
    .withName("experiment_run_processing")
    .withAggregateType("experiment_run")
    .withFoldProjection(
      "experimentRunState",
      new ExperimentRunStateFoldProjection({
        store: new CachedFoldStore<ExperimentRunStateData>(
          createExperimentRunStateFoldStore(deps.experimentRunStateRepository),
          deps.foldCacheClient,
          { keyPrefix: "experiment_runs" },
        ),
      }),
    )
    .withMapProjection(
      "experimentRunResultStorage",
      new ExperimentRunResultStorageMapProjection({
        store: deps.experimentRunItemAppendStore,
      }),
    )
    // The three run events `orgBillableEventsMeter` records. An organization
    // that only runs experiments has no other billable stream, so without this
    // mount its month would never be reported at all.
    .withEventSubscriber(
      "billingMeterPoke",
      createBillingMeterPokeSubscriber<ExperimentRunProcessingEvent>({
        eventTypes: [
          EXPERIMENT_RUN_EVENT_TYPES.STARTED,
          EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
          EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
        ],
        reportUsageForMonth: deps.commands.port(ReportUsageForMonthCommand),
        isSaas: deps.isSaas,
      }),
    );

  let withCommands = builder
    .withCommand("startExperimentRun", StartExperimentRunCommand)
    .withCommand("recordTargetResult", RecordTargetResultCommand)
    .withCommand("recordEvaluatorResult", RecordEvaluatorResultCommand)
    .withCommand("completeExperimentRun", CompleteExperimentRunCommand);

  if (deps.experimentRunExecutionEffects !== null) {
    withCommands = withCommands.withProcessManager(
      EXPERIMENT_RUN_EXECUTION_PROCESS_NAME,
      experimentRunExecutionPM({
        // The terminal write is this pipeline's own command, bound here rather
        // than injected — `completeExperimentRun` carries a fixed idempotency
        // key, so a retry or a race with the run's own completion collapses.
        completeRun: deps.commands.port(CompleteExperimentRunCommand),
        ...deps.experimentRunExecutionEffects,
      }),
    );
  }

  return withCommands.build();
}
