import { definePipeline } from "~/server/event-sourcing";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import {
  ConfigureIngestionPullCommand,
  DisableIngestionPullCommand,
  RecordIngestionPullRunCompletedCommand,
  RecordIngestionPullRunFailedCommand,
} from "./commands";
import {
  type IngestionPullRunStatusData,
  IngestionPullRunStatusFoldProjection,
} from "./projections/ingestionPullRunStatus.foldProjection";
import type { IngestionPullProcessingEvent } from "./schemas/events";

export interface IngestionPullProcessingPipelineDeps {
  /** Rebuildable per-source cursor and operator-facing run status. */
  runStatusStore: StateProjectionStore<IngestionPullRunStatusData>;
  /** The process-manager subscriber and any future live consumers. */
  subscribers?: EventSubscriberDefinition<IngestionPullProcessingEvent>[];
}

/**
 * Creates the ingestion-pull-processing pipeline definition.
 *
 * Aggregate: `ingestion_pull` (aggregateId = sourceId, TenantId = hidden
 * governance project id) — one ordered stream per ingestion source.
 *
 * Scheduling and pull execution live outside the static definition in the
 * ingestion pull process manager and transactional process outbox.
 */
export function createIngestionPullProcessingPipeline(
  deps: IngestionPullProcessingPipelineDeps,
) {
  let builder = definePipeline<IngestionPullProcessingEvent>()
    .withName("ingestion_pull_processing")
    .withAggregateType("ingestion_pull")
    .withProjection(
      "ingestionPullRunStatus",
      new IngestionPullRunStatusFoldProjection({ store: deps.runStatusStore }),
    );

  for (const subscriber of deps.subscribers ?? []) {
    builder = builder.withEventSubscriber(subscriber.name, subscriber);
  }

  return builder
    .withCommand("configure", ConfigureIngestionPullCommand)
    .withCommand("disable", DisableIngestionPullCommand)
    .withCommand("recordRunCompleted", RecordIngestionPullRunCompletedCommand)
    .withCommand("recordRunFailed", RecordIngestionPullRunFailedCommand)
    .build();
}
