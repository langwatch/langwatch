import type { LangyTurnAdmissionRepository } from "../repositories/langy-turn-admission.repository";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";

const TERMINAL_EVENTS = [
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
  LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
  LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
] as const;

/**
 * Reconciles Postgres admission from canonical lifecycle events. Acceptance
 * independently closes the request-process crash window; terminal events
 * release only their matching turn so a stale final cannot free a newer one.
 */
export function createLangyTurnAdmissionLifecycleSubscriber(deps: {
  admissions: Pick<LangyTurnAdmissionRepository, "confirmAccepted" | "release">;
}): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  return {
    name: "langyTurnAdmissionLifecycle",
    eventTypes: [
      LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
      ...TERMINAL_EVENTS,
    ],
    options: {
      deduplication: {
        makeId: (event) => `langy-turn-admission-lifecycle:${event.id}`,
      },
    },
    async handle(event): Promise<void> {
      const projectId = event.tenantId;
      const conversationId = String(event.aggregateId);
      const turnId = "turnId" in event.data ? event.data.turnId : undefined;
      if (event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED) {
        await deps.admissions.confirmAccepted({
          projectId,
          conversationId,
          turnId: event.data.turnId,
        });
        return;
      }
      await deps.admissions.release({
        projectId,
        conversationId,
        ...(turnId ? { turnId } : {}),
      });
    },
  };
}
