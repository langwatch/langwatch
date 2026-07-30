import {
  definePipeline,
  type Metrics,
  type ReplaceStore,
} from "@langwatch/event-sourcing";

import {
  configureIngestionPull,
  disableIngestionPull,
  recordIngestionPullRunCompleted,
  recordIngestionPullRunFailed,
} from "./commands";
import {
  ingestionPullOn,
  ingestionPullOnWake,
} from "./process-manager/ingestionPull.process";
import {
  type IngestionPullOutcomeCommands,
  type IngestionPullRunPort,
  ingestionPullIntents,
} from "./process-manager/ingestionPullEffects";
import {
  INGESTION_PULL_PROCESS_NAME,
  ingestionPullProcessStateSchema,
  initIngestionPullProcessState,
} from "./process-manager/ingestionPullProcess.types";
import {
  applyConfigured,
  applyDisabled,
  applyRunCompleted,
  applyRunFailed,
  INGESTION_PULL_RUN_STATUS_PROJECTION,
  INGESTION_PULL_RUN_STATUS_VERSION,
  type IngestionPullRunStatusData,
  ingestionPullRunStatusSchema,
  initIngestionPullRunStatus,
} from "./projections/ingestionPullRunStatus.projection";
import {
  INGESTION_PULL_PIPELINE_NAME,
  INGESTION_PULL_PIPELINE_PREFIX,
  ingestionPullConfiguredCommandDataSchema,
  ingestionPullDisabledDataSchema,
  ingestionPullEvents,
  ingestionPullRunCompletedDataSchema,
  ingestionPullRunFailedDataSchema,
} from "./schemas/events";

export interface IngestionPullProcessingPipelineDeps {
  /** Rebuildable per-source cursor and operator-facing run status. */
  readonly runStatusStore: ReplaceStore<IngestionPullRunStatusData>;
  /** Runs one pull attempt from the durable cursor — the intent's domain function. */
  readonly runPort: IngestionPullRunPort;
  /** This same pipeline's two outcome commands, resolved by name at send time. */
  readonly commands: IngestionPullOutcomeCommands;
  readonly metrics?: Metrics;
}

/**
 * The `ingestion_pull` aggregate (aggregateId = sourceId, TenantId = the hidden
 * governance project) — one ordered stream per ingestion source.
 *
 * Its process manager owns each source's cron wake, the pull run lifecycle and
 * the durable cursor. The cadence is each source's own cron expression, so
 * every handler returns its explicit `nextWakeAt`.
 */
export function createIngestionPullProcessingPipeline(
  deps: IngestionPullProcessingPipelineDeps,
) {
  return definePipeline(INGESTION_PULL_PIPELINE_NAME)
    .prefix(INGESTION_PULL_PIPELINE_PREFIX)
    .events(ingestionPullEvents)
    .id({
      configured: (data) => data.sourceId,
      disabled: (data) => data.sourceId,
      runCompleted: (data) => data.sourceId,
      runFailed: (data) => data.sourceId,
    })
    .withCommand("configure", {
      input: ingestionPullConfiguredCommandDataSchema,
      handle: configureIngestionPull,
    })
    .withCommand("disable", {
      input: ingestionPullDisabledDataSchema,
      handle: disableIngestionPull,
    })
    .withCommand("recordRunCompleted", {
      input: ingestionPullRunCompletedDataSchema,
      handle: recordIngestionPullRunCompleted,
    })
    .withCommand("recordRunFailed", {
      input: ingestionPullRunFailedDataSchema,
      handle: recordIngestionPullRunFailed,
    })
    .withFold(INGESTION_PULL_RUN_STATUS_PROJECTION, {
      state: ingestionPullRunStatusSchema,
      init: initIngestionPullRunStatus,
      pin: INGESTION_PULL_RUN_STATUS_VERSION,
      on: {
        configured: applyConfigured,
        disabled: applyDisabled,
        runCompleted: applyRunCompleted,
        runFailed: applyRunFailed,
      },
      store: deps.runStatusStore,
    })
    .withProcessManager(INGESTION_PULL_PROCESS_NAME, {
      state: ingestionPullProcessStateSchema,
      init: initIngestionPullProcessState,
      intents: ingestionPullIntents({
        runPort: deps.runPort,
        commands: deps.commands,
      }),
      on: ingestionPullOn,
      onWake: ingestionPullOnWake,
    })
    .build({ metrics: deps.metrics });
}
