import type {
  HandleResult,
  ProcessEventEnvelope,
} from "~/server/event-sourcing/process-manager";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";

import { toLangyProcessEnvelope } from "../../langyConversationProcess.definition";

/**
 * Test double for the ProcessRuntime trigger adapter (the production path
 * since ADR-052's withProcessManager): maps a committed pipeline event to
 * the content-stripped envelope, hands it to the manager, throws on a
 * revision conflict (queue-redelivery semantics), nudges the outbox on
 * commit. Mirrors ProcessRuntime.consumeFacts so these suites keep driving
 * the real service + stores with a controllable clock.
 */
export function createLangyProcessTestSubscriber(params: {
  processManager: {
    handleEvent(input: {
      envelope: ProcessEventEnvelope;
      now: number;
    }): Promise<HandleResult>;
  };
  notifyOutbox?: () => void;
  clock?: () => number;
}) {
  const clock = params.clock ?? (() => Date.now());
  return {
    handle: async (
      event: LangyConversationProcessingEvent,
      _context: { tenantId: string; aggregateId: string },
    ) => {
      const base = toLangyProcessEnvelope(event);
      const envelope: ProcessEventEnvelope = {
        ...base,
        // The runtime suffixes the processKey — one event may concern
        // several process instances; the inbox consumes ids per scope.
        eventId: `${event.id}:${base.processKey}`,
      };
      const result = await params.processManager.handleEvent({
        envelope,
        now: clock(),
      });
      if (result.outcome === "revisionConflict") {
        throw new Error(
          `langyConversation revision conflict on event ${event.id} — retry via queue redelivery`,
        );
      }
      if (result.outcome === "committed") {
        params.notifyOutbox?.();
      }
    },
  };
}
