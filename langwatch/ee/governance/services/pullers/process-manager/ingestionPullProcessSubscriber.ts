import { INGESTION_PULL_PROCESSING_EVENT_TYPES } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import type { IngestionPullProcessingEvent } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/events";
import type {
  HandleResult,
  ProcessEventEnvelope,
} from "~/server/event-sourcing/process-manager";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { toIngestionPullProcessEnvelope } from "./ingestionPullProcess.definition";

/** The slice of ProcessManagerService this subscriber needs. */
export interface IngestionPullProcessManagerPort {
  handleEvent(params: {
    envelope: ProcessEventEnvelope;
    now: number;
  }): Promise<HandleResult>;
}

export function createIngestionPullProcessSubscriber(params: {
  processManager: IngestionPullProcessManagerPort;
  /** Best-effort latency nudge; Postgres polling remains the recovery path. */
  notifyOutbox?: () => void;
  /** Injectable for deterministic tests. */
  clock?: () => number;
}): EventSubscriberDefinition<IngestionPullProcessingEvent> {
  const clock = params.clock ?? (() => Date.now());
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
          `Ingestion pull process revision conflict on event ${event.id} (actual revision ${result.actualRevision}) — retry via queue redelivery`,
        );
      }
      if (result.outcome === "committed") {
        params.notifyOutbox?.();
      }
    },
  };
}
