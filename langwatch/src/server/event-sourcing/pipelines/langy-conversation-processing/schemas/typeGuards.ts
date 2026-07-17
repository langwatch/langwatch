import { LANGY_CONVERSATION_EVENT_TYPES } from "./constants";
import type {
  LangyAgentResponseFailedEvent,
  LangyAgentTurnAcceptedEvent,
  LangyAgentRespondedEvent,
  LangyConversationArchivedEvent,
  LangyMessageRecordedEvent,
  LangyConversationStartedEvent,
  LangyConversationMetadataUpdatedEvent,
  LangyConversationProcessingEvent,
  LangyConversationHandoffPendingEvent,
  LangyConversationHandoffConsumedEvent,
  LangyConversationTitleGeneratedEvent,
  LangyPlanUpdatedEvent,
  LangyToolCallFailedEvent,
  LangyToolCallInitiatedEvent,
  LangyToolCallSucceededEvent,
} from "./events";

export function isLangyConversationStartedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyConversationStartedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED;
}

export function isLangyMessageRecordedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyMessageRecordedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED;
}

export function isLangyAgentTurnAcceptedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyAgentTurnAcceptedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED;
}

export function isLangyToolCallInitiatedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyToolCallInitiatedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED;
}

export function isLangyToolCallSucceededEvent(
  event: LangyConversationProcessingEvent,
): event is LangyToolCallSucceededEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED;
}

export function isLangyToolCallFailedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyToolCallFailedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED;
}

export function isLangyPlanUpdatedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyPlanUpdatedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED;
}

export function isLangyAgentResponseFailedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyAgentResponseFailedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED;
}

export function isLangyAgentRespondedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyAgentRespondedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED;
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

export function isLangyConversationTitleGeneratedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyConversationTitleGeneratedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED;
}
