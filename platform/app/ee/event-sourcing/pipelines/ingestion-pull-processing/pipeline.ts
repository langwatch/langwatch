import { definePipeline } from "~/server/event-sourcing.old";
import type { CommandBus } from "~/server/event-sourcing.old/commands/commandBus";
import type { ProcessManagerApplier } from "~/server/event-sourcing.old/pipeline/processBuilder";
import type { StateProjectionStore } from "~/server/event-sourcing.old/projections/stateProjection.types";

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
  type IngestionPullRunPort,
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
 *  inline below, ADR-052 "Approved builder API" (retired; ground now
 *  ADR-098), like the core domains.
 *
 *  ADR-082 Rule 1 (retired; ground now ADR-102): the executor's dispatch
 *  bundle is built here, from the run
 *  port and this pipeline's own commands, so nothing in this interface is a
 *  value the builder registers and nothing has to be resolved after `.build()`. */
export interface IngestionPullProcessingPipelineDeps {
  /** Rebuildable per-source cursor and operator-facing run status. */
  runStatusStore: StateProjectionStore<IngestionPullRunStatusData>;
  /** Runs one pull attempt from the durable cursor — the effect's domain function. */
  runPort: IngestionPullRunPort;
  /** ADR-082 §5 (retired; ground now ADR-102) — identity-keyed dispatch into this pipeline's own commands. */
  commands: CommandBus;
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
 * Process manager: `ingestionPull` (ADR-052 builder, retired; ground now
 * ADR-098) — owns each source's
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
      ingestionPullPM({
        runPort: deps.runPort,
        // The run outcomes are this pipeline's own commands. The bus binds now
        // and resolves by class identity at send time, so naming them here —
        // mid-`.build()`, before the builder has registered them — is sound.
        commands: {
          recordRunCompleted: deps.commands.port(
            RecordIngestionPullRunCompletedCommand,
          ),
          recordRunFailed: deps.commands.port(
            RecordIngestionPullRunFailedCommand,
          ),
        },
      }),
    )
    .build();
}
