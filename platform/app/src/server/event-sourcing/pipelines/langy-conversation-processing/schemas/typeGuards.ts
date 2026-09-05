import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import type {
  LangyAgentRespondedEvent,
  LangyAgentResponseFailedEvent,
  LangyAgentTurnAcceptedEvent,
  LangyConversationArchivedEvent,
  LangyConversationHandoffConsumedEvent,
  LangyConversationHandoffPendingEvent,
  LangyConversationMetadataUpdatedEvent,
  LangyConversationProcessingEvent,
  LangyConversationStartedEvent,
  LangyConversationTitleGeneratedEvent,
  LangyLocalControlRequestedEvent,
  LangyLocalPolicyChangedEvent,
  LangyLocalWorkspaceConnectedEvent,
  LangyLocalWorkspaceDisconnectedEvent,
  LangyMessageRecordedEvent,
  LangyPlanUpdatedEvent,
  LangyToolCallFailedEvent,
  LangyToolCallInitiatedEvent,
  LangyToolCallSucceededEvent,
  LangyUserWaitEndedEvent,
  LangyUserWaitStartedEvent,
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

export function isLangyLocalControlRequestedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyLocalControlRequestedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.LOCAL_CONTROL_REQUESTED;
}

export function isLangyLocalWorkspaceConnectedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyLocalWorkspaceConnectedEvent {
  return (
    event.type === LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_CONNECTED
  );
}

export function isLangyLocalWorkspaceDisconnectedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyLocalWorkspaceDisconnectedEvent {
  return (
    event.type === LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_DISCONNECTED
  );
}

export function isLangyLocalPolicyChangedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyLocalPolicyChangedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.LOCAL_POLICY_CHANGED;
}

export function isLangyUserWaitStartedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyUserWaitStartedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED;
}

export function isLangyUserWaitEndedEvent(
  event: LangyConversationProcessingEvent,
): event is LangyUserWaitEndedEvent {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_ENDED;
}
