import type {
  Evolution,
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessInput,
  ProcessIntent,
} from "~/server/event-sourcing/process-manager";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_TITLE_SOURCE,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";

import {
  LANGY_CONVERSATION_PROCESS_NAME,
  LANGY_PROCESS_INTENT_TYPES,
  langyProcessEventViewSchema,
  type LangyConversationProcessState,
  type LangyProcessEventView,
} from "./langyConversationProcess.types";

/**
 * Maps a committed Langy pipeline event (the real schema union) to the
 * generic process envelope. This is the content boundary: the view keeps
 * identities and flags, and drops message parts, question/answer text, tool
 * commands/inputs, plan items, error text, titles, run tokens, and handoff
 * tokens — the process manager never sees them, so it cannot persist them.
 *
 * In the Langy pipeline the event's TenantId IS the projectId, and the
 * aggregate is the conversation.
 */
export function toLangyProcessEnvelope(
  event: LangyConversationProcessingEvent,
): ProcessEventEnvelope {
  const userId = "userId" in event.data ? event.data.userId : undefined;
  return {
    eventId: event.id,
    eventType: event.type,
    occurredAt: event.occurredAt,
    tenantId: event.tenantId,
    projectId: event.tenantId,
    processKey: event.data.conversationId,
    ...(userId ? { userId } : {}),
    payload: buildProcessEventView(event),
  };
}

function buildProcessEventView(
  event: LangyConversationProcessingEvent,
): LangyProcessEventView {
  return {
    turnId: "turnId" in event.data ? (event.data.turnId ?? null) : null,
    outcome:
      event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED
        ? event.data.outcome
        : null,
    titleTouched:
      event.type === LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED &&
      typeof event.data.title === "string",
  };
}

const INITIAL_STATE: LangyConversationProcessState = {
  currentTurnId: null,
  turnStatus: "idle",
  titleSource: LANGY_TITLE_SOURCE.DERIVED,
  autoTitleRequested: false,
  archived: false,
  pendingHandoffTurnId: null,
};

/**
 * LIVENESS IS OUT OF THIS PILOT (see langyConversationProcess.types.ts):
 * the process schedules no wake-ups, so every evolution settles with
 * nextWakeAt null and no fail-turn intent can ever be produced.
 */
function settle(
  state: LangyConversationProcessState,
  intents: ProcessIntent[] = [],
): Evolution<LangyConversationProcessState> {
  return { state, nextWakeAt: null, intents };
}

/**
 * Automatic titling is a one-shot logical transition: the first SUCCESSFUL
 * agent_responded while the title is still the derived placeholder. Once
 * requested, or once titleSource becomes auto or user, no counter or timer
 * may ever retitle.
 */
function shouldGenerateTitle(
  state: LangyConversationProcessState,
): boolean {
  return (
    state.titleSource === LANGY_TITLE_SOURCE.DERIVED &&
    !state.autoTitleRequested
  );
}

function evolveEvent(
  previousState: LangyConversationProcessState,
  envelope: ProcessEventEnvelope,
): Evolution<LangyConversationProcessState> {
  const view = langyProcessEventViewSchema.parse(envelope.payload);
  const conversationId = envelope.processKey;

  switch (envelope.eventType) {
    case LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED: {
      if (previousState.archived || view.turnId === null) {
        return settle(previousState);
      }
      // Postgres admission is authoritative. This guard is the final defence
      // for an older/misbehaving caller that bypassed it: never replace the
      // running turn or emit a second dispatch for the same conversation.
      if (
        previousState.turnStatus === "running" &&
        previousState.currentTurnId !== view.turnId
      ) {
        return settle(previousState);
      }
      return settle(
        {
          ...previousState,
          currentTurnId: view.turnId,
          turnStatus: "running",
        },
        [
          {
            messageKey: `dispatch:${view.turnId}`,
            intentType: LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH,
            payload: {
              conversationId,
              turnId: view.turnId,
              resumeFromTurnId: previousState.pendingHandoffTurnId,
            },
          },
        ],
      );
    }

    case LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED: {
      if (view.turnId === null || view.turnId !== previousState.currentTurnId) {
        return settle(previousState);
      }
      const succeeded = view.outcome !== "failed";
      const generateTitle =
        succeeded && !previousState.archived && shouldGenerateTitle(previousState);
      return settle(
        {
          ...previousState,
          currentTurnId: null,
          turnStatus: succeeded ? "completed" : "failed",
          autoTitleRequested:
            previousState.autoTitleRequested || generateTitle,
        },
        generateTitle
          ? [
              {
                messageKey: `title:${view.turnId}`,
                intentType: LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE,
                payload: { conversationId, turnId: view.turnId },
              },
            ]
          : [],
      );
    }

    case LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED: {
      if (view.turnId === null || view.turnId !== previousState.currentTurnId) {
        return settle(previousState);
      }
      return settle({
        ...previousState,
        currentTurnId: null,
        turnStatus: "failed",
      });
    }

    case LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED:
      return settle({
        ...previousState,
        archived: true,
        currentTurnId: null,
        turnStatus: "idle",
      });

    case LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED: {
      // A manual rename is sticky and permanently suppresses auto titles.
      if (!view.titleTouched) return settle(previousState);
      return settle({
        ...previousState,
        titleSource: LANGY_TITLE_SOURCE.USER,
      });
    }

    case LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED: {
      if (previousState.titleSource === LANGY_TITLE_SOURCE.USER) {
        return settle(previousState);
      }
      return settle({
        ...previousState,
        titleSource: LANGY_TITLE_SOURCE.AUTO,
      });
    }

    case LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING: {
      // The turn handed off — it did not fail (ADR-048). Back to idle, keep
      // the turn id (identity only, never the token) so the next dispatch
      // can thread the resume.
      return settle({
        ...previousState,
        currentTurnId: null,
        turnStatus: "idle",
        pendingHandoffTurnId: view.turnId,
      });
    }

    case LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED:
      return settle({ ...previousState, pendingHandoffTurnId: null });

    // Conversation-level or turn-progress activity with no process decision
    // to make. Tool and plan events deliberately fall through here: they
    // only mattered to the liveness window, which is out of this pilot.
    case LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED:
    case LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED:
    case LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED:
    case LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED:
    case LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED:
    case LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED:
    case LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED:
    case LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED:
    default:
      return settle(previousState);
  }
}

export const langyConversationProcessDefinition: ProcessDefinition<LangyConversationProcessState> =
  {
    name: LANGY_CONVERSATION_PROCESS_NAME,
    initialState: INITIAL_STATE,
    evolve: ({
      previousState,
      input,
    }: {
      previousState: LangyConversationProcessState;
      input: ProcessInput;
    }) => {
      if (input.kind === "event") {
        return evolveEvent(previousState, input.event);
      }
      // No wake-up is ever scheduled, so a wake input can only be a forged
      // or leftover token — it decides nothing and re-schedules nothing.
      return settle(previousState);
    },
  };
