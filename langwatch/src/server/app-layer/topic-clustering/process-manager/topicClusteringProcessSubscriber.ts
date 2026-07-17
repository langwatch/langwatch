import type {
  HandleResult,
  ProcessEventEnvelope,
} from "~/server/event-sourcing/process-manager";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES } from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/constants";
import type { TopicClusteringProcessingEvent } from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/events";

import { toTopicClusteringProcessEnvelope } from "./topicClusteringProcess.definition";

/** The slice of ProcessManagerService this subscriber needs. */
export interface TopicClusteringProcessManagerPort {
  handleEvent(params: {
    envelope: ProcessEventEnvelope;
    now: number;
  }): Promise<HandleResult>;
}

/**
 * Thin event-only subscriber (ADR-049 §3, ADR-051) feeding the topic
 * clustering process from the committed queue event. A revision conflict is
 * thrown so GroupQueue redelivers; the process inbox makes the retry a safe
 * no-op if the event actually committed.
 */
export function createTopicClusteringProcessSubscriber(params: {
  processManager: TopicClusteringProcessManagerPort;
  /** Best-effort latency nudge; Postgres polling remains the recovery path. */
  notifyOutbox?: () => void;
  /** Injectable for deterministic tests. */
  clock?: () => number;
}): EventSubscriberDefinition<TopicClusteringProcessingEvent> {
  const clock = params.clock ?? (() => Date.now());
  return {
    name: "topicClusteringProcess",
    eventTypes: TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES,
    handle: async (event) => {
      const result = await params.processManager.handleEvent({
        envelope: toTopicClusteringProcessEnvelope(event),
        now: clock(),
      });
      if (result.outcome === "revisionConflict") {
        throw new Error(
          `Topic clustering process revision conflict on event ${event.id} (actual revision ${result.actualRevision}) — retry via queue redelivery`,
        );
      }
      if (result.outcome === "committed") {
        params.notifyOutbox?.();
      }
    },
  };
}
