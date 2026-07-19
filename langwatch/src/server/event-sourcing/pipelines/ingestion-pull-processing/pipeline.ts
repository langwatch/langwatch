import { definePipeline } from "../../";
import type { StateProjectionStore } from "../../projections/stateProjection.types";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
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

export function createIngestionPullProcessingPipeline(deps: {
  runStatusStore: StateProjectionStore<IngestionPullRunStatusData>;
  subscribers?: EventSubscriberDefinition<IngestionPullProcessingEvent>[];
}) {
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
