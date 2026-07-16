import type {
  HandleResult,
  ProcessEventEnvelope,
} from "~/server/event-sourcing/process-manager";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { LANGY_CONVERSATION_PROCESSING_EVENT_TYPES } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";

import { toLangyProcessEnvelope } from "./langyConversationProcess.definition";

/**
 * The slice of ProcessManagerService this subscriber needs — injected so the
 * adapter has no construction, persistence, or effect concerns of its own.
 */
export interface LangyProcessManagerPort {
  handleEvent(params: {
    envelope: ProcessEventEnvelope;
    now: number;
  }): Promise<HandleResult>;
}

/**
 * Thin event-only subscriber (ADR-049 §3/§5) that feeds the Langy
 * conversation process from the committed queue event:
 *
 * - it receives the event already carried by GroupQueue — it never reads
 *   ClickHouse, a fold, or any projection;
 * - it converts the real event to the content-stripped process envelope, so
 *   parts/tokens/titles never reach process state or outbox rows; and
 * - it runs in the ambient OTel context, so the carrier the process service
 *   injects into each persisted intent continues the pipeline's trace.
 *
 * A revision conflict is thrown so GroupQueue redelivers; the process inbox
 * makes the retry a safe no-op if the event actually committed.
 */
export function createLangyProcessSubscriber(params: {
  processManager: LangyProcessManagerPort;
  /** Best-effort latency nudge; Postgres polling remains the recovery path. */
  notifyOutbox?: () => void;
  /** Injectable for deterministic tests. */
  clock?: () => number;
}): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  const clock = params.clock ?? (() => Date.now());
  return {
    name: "langyConversationProcess",
    eventTypes: LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
    handle: async (event) => {
      const result = await params.processManager.handleEvent({
        envelope: toLangyProcessEnvelope(event),
        now: clock(),
      });
      if (result.outcome === "revisionConflict") {
        throw new Error(
          `Langy process revision conflict on event ${event.id} (actual revision ${result.actualRevision}) — retry via queue redelivery`,
        );
      }
      if (result.outcome === "committed") {
        params.notifyOutbox?.();
      }
    },
  };
}
