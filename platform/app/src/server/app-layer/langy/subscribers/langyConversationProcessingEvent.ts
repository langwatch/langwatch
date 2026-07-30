import type {
  LANGY_CONVERSATION_EVENT_TYPES,
  LangyAgentRespondedEventData,
  LangyAgentResponseFailedEventData,
  LangyAgentTurnAcceptedEventData,
  LangyConversationArchivedEventData,
  LangyConversationForkedEventData,
  LangyConversationHandoffConsumedEventData,
  LangyConversationHandoffPendingEventData,
  LangyConversationMetadataUpdatedEventData,
  LangyConversationStartedEventData,
  LangyConversationTitleGeneratedEventData,
  LangyMessageImportedEventData,
  LangyMessageRecordedEventData,
  LangyPlanUpdatedEventData,
  LangyToolCallFailedEventData,
  LangyToolCallInitiatedEventData,
  LangyToolCallSucceededEventData,
} from "@langwatch/langy";
import type { SubscribedEvent } from "./eventSubscriber.types";

/**
 * Recovered from the deleted event-sourcing tree's
 * `pipelines/langy-conversation-processing/schemas/events` — the union of
 * every langy-conversation event a subscriber may receive, each payload
 * still sourced from `@langwatch/langy`.
 */
export type LangyConversationProcessingEvent =
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
      LangyConversationStartedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED,
      LangyConversationForkedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
      LangyMessageRecordedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED,
      LangyMessageImportedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
      LangyAgentTurnAcceptedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
      LangyToolCallInitiatedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
      LangyToolCallSucceededEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
      LangyToolCallFailedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
      LangyPlanUpdatedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
      LangyAgentResponseFailedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      LangyAgentRespondedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
      LangyConversationArchivedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
      LangyConversationMetadataUpdatedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
      LangyConversationHandoffPendingEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
      LangyConversationHandoffConsumedEventData
    >
  | SubscribedEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED,
      LangyConversationTitleGeneratedEventData
    >;
