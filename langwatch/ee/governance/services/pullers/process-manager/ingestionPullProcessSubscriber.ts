import { INGESTION_PULL_PROCESSING_EVENT_TYPES } from "@ee/governance/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import type { IngestionPullProcessingEvent } from "@ee/governance/event-sourcing/pipelines/ingestion-pull-processing/schemas/events";
import type {
  HandleResult,
  ProcessEventEnvelope,
} from "~/server/event-sourcing/process-manager";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { toIngestionPullProcessEnvelope } from "./ingestionPullProcess.definition";

export function createIngestionPullProcessSubscriber(params: {
  processManager: {
    handleEvent(args: {
      envelope: ProcessEventEnvelope;
      now: number;
    }): Promise<HandleResult>;
  };
  notifyOutbox?: () => void;
  clock?: () => number;
}): EventSubscriberDefinition<IngestionPullProcessingEvent> {
  const clock = params.clock ?? Date.now;
  return {
    name: "ingestionPullProcess",
    eventTypes: INGESTION_PULL_PROCESSING_EVENT_TYPES,
    handle: async (event) => {
      const result = await params.processManager.handleEvent({
        envelope: toIngestionPullProcessEnvelope(event),
        now: clock(),
      });
      if (result.outcome === "revisionConflict") {
        throw new Error(
          `Ingestion pull process revision conflict for ${event.id}`,
        );
      }
      if (result.outcome === "committed") params.notifyOutbox?.();
    },
  };
}
