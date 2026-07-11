import { LANGY_CONVERSATION_EVENT_TYPES } from "./constants";
import type {
  LangyAgentRespondedEvent,
  LangyAgentTurnCompletedEvent,
  LangyAgentTurnFailedEvent,
  LangyAgentTurnStartedEvent,
  LangyConversationArchivedEvent,
  LangyConversationMetadataUpdatedEvent,
  LangyConversationProcessingEvent,
  LangyConversationHandoffPendingEvent,
  LangyConversationHandoffConsumedEvent,
  LangyMessageSentEvent,
  LangyToolCallCompletedEvent,
  LangyToolCallStartedEvent,
  LangyTurnFinalizedEvent,
} from "./events";

export function isLangyMessageSentEvent(
  event: LangyConversationProcessingEvent,
): event is LangyMessageSentEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_SENT;
}

export function isLangyAgentTurnStartedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyAgentTurnStartedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_STARTED;
}

export function isLangyToolCallStartedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyToolCallStartedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_STARTED;
}

export function isLangyToolCallCompletedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyToolCallCompletedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_COMPLETED;
}

export function isLangyAgentRespondedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyAgentRespondedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED;
}

export function isLangyAgentTurnCompletedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyAgentTurnCompletedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_COMPLETED;
}

export function isLangyAgentTurnFailedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyAgentTurnFailedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_FAILED;
}

export function isLangyTurnFinalizedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyTurnFinalizedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.TURN_FINALIZED;
}

export function isLangyConversationArchivedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyConversationArchivedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED;
}

export function isLangyConversationMetadataUpdatedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyConversationMetadataUpdatedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED;
}

export function isLangyConversationHandoffPendingEvent(
  event: LangyConversationProcessingEvent,
): event is LangyConversationHandoffPendingEvent {
  return (
    event.type === LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING
  );
}

export function isLangyConversationHandoffConsumedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyConversationHandoffConsumedEvent {
  return (
    event.type === LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED
  );
}
