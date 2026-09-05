import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy-contract";
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
  LangyMessageRecordedEvent,
  LangyPlanUpdatedEvent,
  LangyToolCallFailedEvent,
  LangyToolCallInitiatedEvent,
  LangyToolCallSucceededEvent,
} from "../adapters/eventing.langy-conversation-events.adapter";

/**
 * Which event a `LangyConversationProcessingEvent` actually is. Fourteen narrowings of one union,
 * each a single comparison against the event type constant.
 */
export class LangyEventGuards {
  static isLangyConversationStartedEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyConversationStartedEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED;
  }

  static isLangyMessageRecordedEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyMessageRecordedEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED;
  }

  static isLangyAgentTurnAcceptedEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyAgentTurnAcceptedEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED;
  }

  static isLangyToolCallInitiatedEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyToolCallInitiatedEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED;
  }

  static isLangyToolCallSucceededEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyToolCallSucceededEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED;
  }

  static isLangyToolCallFailedEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyToolCallFailedEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED;
  }

  static isLangyPlanUpdatedEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyPlanUpdatedEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED;
  }

  static isLangyAgentResponseFailedEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyAgentResponseFailedEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED;
  }

  static isLangyAgentRespondedEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyAgentRespondedEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED;
  }

  static isLangyConversationArchivedEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyConversationArchivedEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED;
  }

  static isLangyConversationMetadataUpdatedEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyConversationMetadataUpdatedEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED;
  }

  static isLangyConversationHandoffPendingEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyConversationHandoffPendingEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING;
  }

  static isLangyConversationHandoffConsumedEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyConversationHandoffConsumedEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED;
  }

  static isLangyConversationTitleGeneratedEvent(
    event: LangyConversationProcessingEvent,
  ): event is LangyConversationTitleGeneratedEvent {
    return event.type === LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED;
  }
}
