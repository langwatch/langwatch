import { definePipeline } from "~/server/event-sourcing";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";

import {
  ConfigureIngestionPullCommand,
  DisableIngestionPullCommand,
  RecordIngestionPullAgentsListedCommand,
  RecordIngestionPullAgentsListingRefusedCommand,
  RecordIngestionPullPeopleListedCommand,
  RecordIngestionPullPeopleListingRefusedCommand,
  RecordIngestionPullRunCompletedCommand,
  RecordIngestionPullRunFailedCommand,
  RequestIngestionPullAgentsListingCommand,
  RequestIngestionPullPeopleListingCommand,
} from "./commands";
import {
  buildProcessEventView,
  handleAgentsListed,
  handleAgentsListingRefused,
  handleAgentsListingRequested,
  handlePeopleListed,
  handlePeopleListingRefused,
  handlePeopleListingRequested,
  handlePullConfigured,
  handlePullDisabled,
  handlePullRunCompleted,
  handlePullRunFailed,
  INITIAL_INGESTION_PULL_STATE,
  ingestionPullWake,
} from "./process-manager/ingestionPull.process";
import {
  createAgentListingHandler,
  createIngestionPullRunHandler,
  createPeopleListingHandler,
  INGESTION_PULL_CONCURRENCY,
  INGESTION_PULL_LEASE_DURATION_MS,
  INGESTION_PULL_MAX_ATTEMPTS,
  type IngestionPullDispatchDeps,
} from "./process-manager/ingestionPullEffects";
import {
  INGESTION_PULL_PROCESS_INTENT_TYPES,
  INGESTION_PULL_PROCESS_NAME,
  ingestionPullListingIntentSchema,
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
      .intent(
        INGESTION_PULL_PROCESS_INTENT_TYPES.LIST_AGENTS,
        ingestionPullListingIntentSchema,
        createAgentListingHandler(dispatch),
      )
      .intent(
        INGESTION_PULL_PROCESS_INTENT_TYPES.LIST_PEOPLE,
        ingestionPullListingIntentSchema,
        createPeopleListingHandler(dispatch),
      )
      .on(INGESTION_PULL_EVENT_TYPES.CONFIGURED, handlePullConfigured)
      .on(INGESTION_PULL_EVENT_TYPES.DISABLED, handlePullDisabled)
      .on(INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED, handlePullRunCompleted)
      .on(INGESTION_PULL_EVENT_TYPES.RUN_FAILED, handlePullRunFailed)
      .on(
        INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
        handleAgentsListingRequested,
      )
      .on(INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED, handleAgentsListed)
      .on(
        INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REFUSED,
        handleAgentsListingRefused,
      )
      .on(
        INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REQUESTED,
        handlePeopleListingRequested,
      )
      .on(INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTED, handlePeopleListed)
      .on(
        INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REFUSED,
        handlePeopleListingRefused,
      )
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
 *
 * It also owns on-demand listings, which have no cadence at all: a caller
 * emits `requestAgentsListing` or `requestPeopleListing`, and the matching
 * intent runs once under this process manager's leases and retries. Those
 * handlers settle through the same `nextWakeAt` the pull handlers do, so
 * asking a source what it knows never moves the schedule it is already
 * keeping.
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
    .withCommand(
      "requestAgentsListing",
      RequestIngestionPullAgentsListingCommand,
    )
    .withCommand("recordAgentsListed", RecordIngestionPullAgentsListedCommand)
    .withCommand(
      "recordAgentsListingRefused",
      RecordIngestionPullAgentsListingRefusedCommand,
    )
    .withCommand(
      "requestPeopleListing",
      RequestIngestionPullPeopleListingCommand,
    )
    .withCommand("recordPeopleListed", RecordIngestionPullPeopleListedCommand)
    .withCommand(
      "recordPeopleListingRefused",
      RecordIngestionPullPeopleListingRefusedCommand,
    )
    .withProcessManager(
      INGESTION_PULL_PROCESS_NAME,
      ingestionPullPM(deps.dispatch),
    )
    .build();
}
