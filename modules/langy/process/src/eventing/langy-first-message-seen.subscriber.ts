/**
 * `first_message_seen`: a completed answer from Langy in a conversation the user owns is the user
 * getting Langy's message. Recorded as a fact against the owner; the fact's idempotency key names
 * only the user, so the first one counts. Nurturing sets the person's trait from it.
 * @see specs/langy/langy-first-message-seen.feature
 */
import { DispatchError, type EventSubscriberDefinition } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  type LangyFirstMessageSeenEventData,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import type { LangyConversationProcessingEvent } from "./langy-conversation-state.projection.ts";

const logger = createLogger("langwatch:langy:first-message-seen");

/** A conversation's answers in a day reach the fact once: later ones would change nothing. */
const FIRST_MESSAGE_SEEN_DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

interface LangyConversationOwnerReader {
  /** Throws `langy_conversation_not_found` until the conversation is folded. */
  getById(params: {
    projectId: string;
    conversationId: string;
  }): Promise<{ ownerUserId: string | null }>;
}

/** The fact langy records when a person gets an answer from Langy. */
export interface LangyFirstMessageSeenFacts {
  recordFirstMessageSeen(data: LangyFirstMessageSeenEventData): Promise<void>;
}

/** Whether the event is a completed answer from Langy; a failed or stopped turn is not. */
export function isCompletedLangyAnswer(event: LangyConversationProcessingEvent): boolean {
  return (
    event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED &&
    event.data.outcome === "completed"
  );
}

export function createLangyFirstMessageSeenSubscriber(deps: {
  conversations: LangyConversationOwnerReader;
  facts: LangyFirstMessageSeenFacts;
}): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  return {
    name: "langyFirstMessageSeen",
    eventTypes: [LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED],
    options: {
      deduplication: {
        makeId: (event) => `langy-first-message-seen:${String(event.aggregateId)}`,
        ttlMs: FIRST_MESSAGE_SEEN_DEDUP_TTL_MS,
        extend: false,
        replace: false,
        shouldSurviveDispatch: true,
      },
      enqueue: { filter: (event) => isCompletedLangyAnswer(event) },
    },
    async handle(event): Promise<void> {
      if (!isCompletedLangyAnswer(event)) return;
      const projectId = event.tenantId;
      const conversationId = String(event.aggregateId);
      // Not folded yet: retryable, since a 404 HandledError alone would block the job's group.
      const conversation = await deps.conversations
        .getById({ projectId, conversationId })
        .catch((error: unknown) => {
          if (HandledError.isHandled(error) && error.code === "langy_conversation_not_found") {
            throw new DispatchError({
              message: `Langy conversation ${conversationId} is not folded yet; retrying`,
              retryable: true,
              cause: error,
            });
          }
          throw error;
        });
      const userId = conversation.ownerUserId;
      if (!userId) {
        logger.warn({ projectId, conversationId }, "Langy answered a conversation with no owner");
        return;
      }
      await deps.facts.recordFirstMessageSeen({
        tenantId: projectId,
        occurredAt: event.occurredAt,
        userId,
        conversationId,
      });
    },
  };
}
