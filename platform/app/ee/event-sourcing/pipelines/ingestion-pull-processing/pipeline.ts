import { definePipeline } from "~/server/event-sourcing";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";

import {
  ConfigureIngestionPullCommand,
  DisableIngestionPullCommand,
  RecordIngestionPullRunCompletedCommand,
  RecordIngestionPullRunFailedCommand,
} from "./commands";
import {
  buildProcessEventView,
  handlePullConfigured,
  handlePullDisabled,
  handlePullRunCompleted,
  handlePullRunFailed,
  INITIAL_INGESTION_PULL_STATE,
  ingestionPullWake,
} from "./process-manager/ingestionPull.process";
import {
  createIngestionPullRunHandler,
  INGESTION_PULL_CONCURRENCY,
  INGESTION_PULL_LEASE_DURATION_MS,
  INGESTION_PULL_MAX_ATTEMPTS,
  type IngestionPullDispatchDeps,
} from "./process-manager/ingestionPullEffects";
import {
  INGESTION_PULL_PROCESS_INTENT_TYPES,
  INGESTION_PULL_PROCESS_NAME,
  ingestionPullRunIntentSchema,
} from "./process-manager/ingestionPullProcess.types";
import {
  type IngestionPullRunStatusData,
  IngestionPullRunStatusFoldProjection,
} from "./projections/ingestionPullRunStatus.foldProjection";
import { INGESTION_PULL_EVENT_TYPES } from "./schemas/constants";
import type { IngestionPullProcessingEvent } from "./schemas/events";

/** Only the executor dependencies are injected — the process-manager
 *  topology itself (state, intents, handlers, outbox tuning) is declared
 *  inline below, ADR-052 "Approved builder API", like the core domains. */
export interface IngestionPullProcessingPipelineDeps {
  /** Rebuildable per-source cursor and operator-facing run status. */
  runStatusStore: StateProjectionStore<IngestionPullRunStatusData>;
  dispatch: IngestionPullDispatchDeps;
}

/**
 * The `ingestionPull` process-manager topology, exported standalone so tests
 * can build the exact definition the runtime mounts (clamping, key
 * prefixing, undeclared-event guard included) via `buildProcessManager` +
 * `buildProcessDefinition`.
 */
export function ingestionPullPM(
  dispatch: IngestionPullDispatchDeps,
): ProcessManagerApplier<IngestionPullProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_INGESTION_PULL_STATE)
      .intent(
        INGESTION_PULL_PROCESS_INTENT_TYPES.RUN,
        ingestionPullRunIntentSchema,
        createIngestionPullRunHandler(dispatch),
      )
      .on(INGESTION_PULL_EVENT_TYPES.CONFIGURED, handlePullConfigured)
      .on(INGESTION_PULL_EVENT_TYPES.DISABLED, handlePullDisabled)
      .on(INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED, handlePullRunCompleted)
      .on(INGESTION_PULL_EVENT_TYPES.RUN_FAILED, handlePullRunFailed)
      .onWake(ingestionPullWake)
      .toPayload(buildProcessEventView)
      .outbox({
        maxAttempts: INGESTION_PULL_MAX_ATTEMPTS,
        leaseDurationMs: INGESTION_PULL_LEASE_DURATION_MS,
        concurrency: INGESTION_PULL_CONCURRENCY,
        batchSize: INGESTION_PULL_CONCURRENCY,
      });
}

/**
 * Creates the ingestion-pull-processing pipeline definition.
 *
 * Aggregate: `ingestion_pull` (aggregateId = sourceId, TenantId = hidden
 * governance project id) — one ordered stream per ingestion source.
 *
 * Process manager: `ingestionPull` (ADR-052 builder) — owns each source's
 * cron wake, the pull run lifecycle, and the durable cursor. It deliberately
 * declares no `.schedule()`: the cadence is each source's own cron
 * expression, so every handler returns its explicit `nextWakeAt`.
 */
export function createIngestionPullProcessingPipeline(
  deps: IngestionPullProcessingPipelineDeps,
) {
  return definePipeline<IngestionPullProcessingEvent>()
    .withName("ingestion_pull_processing")
    .withAggregateType("ingestion_pull")
    .withProjection(
      "ingestionPullRunStatus",
      new IngestionPullRunStatusFoldProjection({ store: deps.runStatusStore }),
    )
    .withCommand("configure", ConfigureIngestionPullCommand)
    .withCommand("disable", DisableIngestionPullCommand)
    .withCommand("recordRunCompleted", RecordIngestionPullRunCompletedCommand)
    .withCommand("recordRunFailed", RecordIngestionPullRunFailedCommand)
    .withProcessManager(
      INGESTION_PULL_PROCESS_NAME,
      ingestionPullPM(deps.dispatch),
    )
    .build();
}
