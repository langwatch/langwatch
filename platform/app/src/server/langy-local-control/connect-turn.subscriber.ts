/**
 * The turn a folder is owed when it connected while the turn before still
 * read as in flight (ADR-129).
 *
 * The in-flight reading a turn start is refused on is folded from events, so
 * a folder that connects seconds after a turn ended is refused as a second
 * turn while no turn is left to pick it up. `afterRegister` records the turn
 * as owed; this subscriber starts it when the ended turn's end is folded,
 * once, under the same idempotency key the direct start would have used. A
 * turn that reached the folder settled the debt itself (the dispatcher clears
 * it on the first call), and so did a share that ended.
 *
 * @see specs/langy/langy-local-control.feature
 */

import {
  cursorHasReachedEvent,
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_STATUS,
} from "@langwatch/langy";
import { createLogger } from "@langwatch/observability";
import { LangyTurnInProgressError } from "~/server/app-layer/langy/errors";
import { projectionNotReadyError } from "~/server/app-layer/langy/subscribers/projection-cursor";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import type { ProjectionCursor } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import type { LocalWorkspacePresence, OwedConnectTurn } from "./presence";
import {
  type ControlTurnStarter,
  connectMessage,
  connectTurnIdempotencyKey,
} from "./session.core";

const logger = createLogger("langwatch:langy:local-control:connect-turn");

/** The folded conversation, as far as the owed turn reads it. */
export interface LocalConnectTurnConversationReader {
  read(params: { projectId: string; conversationId: string }): Promise<{
    cursor: ProjectionCursor;
    status: string;
  } | null>;
}

export interface LocalConnectTurnSubscriberDeps {
  /** Read at handle time: the process runtime is composed after the pipeline. */
  presence: () => Pick<
    LocalWorkspacePresence,
    "read" | "readOwedConnectTurn" | "settleOwedConnectTurn"
  >;
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
      deduplication: {
        makeId: (event) => `langy-local-connect-turn:${event.id}`,
      },
    },
    async handle(event): Promise<void> {
      const projectId = event.tenantId;
      const conversationId = String(event.aggregateId);
      const presence = deps.presence();
      const owed = await owedTurnOf(presence, conversationId);
      if (!owed) return;

      const record = await deps.conversations.read({
        projectId,
        conversationId,
      });
      if (!record || !cursorHasReachedEvent(record.cursor, event)) {
        throw projectionNotReadyError({
          projectionName: "langyConversation",
          eventId: event.id,
        });
      }
      // A newer turn is running: it reaches the folder itself, and its own
      // end comes back here.
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

/**
 * The turn the folder is still owed: none once the share ended, or once a
 * newer share took the conversation over and made its own connection.
 */
async function owedTurnOf(
  presence: ReturnType<LocalConnectTurnSubscriberDeps["presence"]>,
  conversationId: string,
): Promise<OwedConnectTurn | null> {
  const owed = await presence.readOwedConnectTurn(conversationId);
  if (!owed) return null;
  const folder = await presence.read(conversationId);
  if (folder && folder.requestId === owed.requestId) return owed;
  await presence.settleOwedConnectTurn(conversationId);
  return null;
}

/**
 * Starts the owed turn. The ended turn's admission row is released by a
 * sibling subscriber; until it is, the start is refused as in flight, and the
 * refusal is thrown for the queue to retry this one.
 */
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
