/**
 * Starts the connect turn a folder is owed when it connected while the turn before still read
 * as in flight (ADR-129): once that turn's end is folded, once, under the direct start's key.
 * @see specs/langy/langy-local-control.feature
 */
import type { EventSubscriberDefinition, ProjectionCursor } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import {
  cursorHasReachedEvent,
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_STATUS,
  LangyTurnInProgressError,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import type {
  LangyLocalPresenceRepository,
  OwedConnectTurn,
} from "../repositories/langy-local-presence.repository.ts";
import type { ControlTurnStarter } from "../rules/langy-local-session-contract.rules.ts";
import {
  connectMessage,
  connectTurnIdempotencyKey,
} from "../rules/langy-local-session-text.rules.ts";
import type { LangyConversationProcessingEvent } from "./langy-conversation-state.projection.ts";

const logger = createLogger("langwatch:langy:local-control:connect-turn");

/** The folded conversation, as far as the owed turn reads it. */
export interface LocalConnectTurnConversationReader {
  /** Throws `langy_conversation_not_found` until the conversation is folded. */
  getById(params: {
    projectId: string;
    conversationId: string;
  }): Promise<{ cursor: ProjectionCursor; status: string }>;
}

export type LocalConnectTurnPresence = Pick<
  LangyLocalPresenceRepository,
  "getByConversationId" | "readOwedConnectTurn" | "settleOwedConnectTurn"
>;

export interface LocalConnectTurnSubscriberDeps {
  /** Read at handle time: the process runtime is composed after the pipeline. */
  presence: () => LocalConnectTurnPresence;
  conversations: LocalConnectTurnConversationReader;
  turns: ControlTurnStarter;
}

export function createLocalConnectTurnSubscriber(
  deps: LocalConnectTurnSubscriberDeps,
): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  return {
    name: "langyLocalConnectTurn",
    eventTypes: [
      LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
    ],
    options: {
      deduplication: { makeId: (event) => `langy-local-connect-turn:${event.id}` },
    },
    async handle(event): Promise<void> {
      const projectId = event.tenantId;
      const conversationId = String(event.aggregateId);
      const presence = deps.presence();
      const owed = await owedTurnOf(presence, conversationId);
      if (!owed) return;

      const record = await deps.conversations
        .getById({ projectId, conversationId })
        .catch((error: unknown) => {
          if (HandledError.isHandled(error) && error.code === "langy_conversation_not_found")
            return null;
          throw error;
        });
      if (!record || !cursorHasReachedEvent(record.cursor, event)) {
        throw new Error(`langyConversation has not projected event ${event.id} yet`);
      }
      // A newer turn is running: it reaches the folder itself, and its own end comes back here.
      if (record.status === LANGY_CONVERSATION_STATUS.RUNNING) return;

      await startOwedTurn(deps.turns, { projectId, conversationId, owed });
      await presence.settleOwedConnectTurn(conversationId);
      logger.info(
        { conversationId, requestId: owed.requestId },
        "owed connect turn started after the turn before it ended",
      );
    },
  };
}

/** The owed turn, unless the share ended or a newer share took the conversation over. */
async function owedTurnOf(
  presence: LocalConnectTurnPresence,
  conversationId: string,
): Promise<OwedConnectTurn | null> {
  const owed = await presence.readOwedConnectTurn(conversationId);
  if (!owed) return null;
  const folder = await presence.getByConversationId(conversationId).catch((error: unknown) => {
    if (HandledError.isHandled(error) && error.code === "langy_local_workspace_offline") {
      return null;
    }
    throw error;
  });
  if (folder && folder.requestId === owed.requestId) return owed;
  await presence.settleOwedConnectTurn(conversationId);
  return null;
}

/** An in-flight refusal (the ended turn's admission not yet released) is rethrown to retry. */
async function startOwedTurn(
  turns: ControlTurnStarter,
  {
    projectId,
    conversationId,
    owed,
  }: { projectId: string; conversationId: string; owed: OwedConnectTurn },
): Promise<void> {
  try {
    await turns.start({
      projectId,
      conversationId,
      userId: owed.userId,
      text: connectMessage(),
      idempotencyKey: connectTurnIdempotencyKey(owed.requestId),
    });
  } catch (error) {
    if (LangyTurnInProgressError.is(error)) {
      logger.info(
        { conversationId, requestId: owed.requestId },
        "owed connect turn still refused as in flight, retrying",
      );
    }
    throw error;
  }
}
