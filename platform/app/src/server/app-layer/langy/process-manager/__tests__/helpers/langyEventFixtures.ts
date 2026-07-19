import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import {
  LangyAgentRespondedEventSchema,
  LangyAgentResponseFailedEventSchema,
  LangyAgentTurnAcceptedEventSchema,
  LangyConversationArchivedEventSchema,
  LangyMessageRecordedEventSchema,
  LangyConversationHandoffConsumedEventSchema,
  LangyConversationHandoffPendingEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  LangyConversationStartedEventSchema,
  LangyConversationTitleGeneratedEventSchema,
  LangyPlanUpdatedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";

export const PROJECT_ID = "proj_langy";
export const CONVERSATION_ID = "conv_langy_1";
export const USER_ID = "user_langy_1";
export const T0 = 1_752_600_000_000;

/**
 * Distinctive strings planted in event content so tests can prove that no
 * conversation content, credential, or token ever reaches process state or
 * outbox rows (ADR-049 §4).
 */
export const SENTINELS = {
  runToken: "RUN_TOKEN_SENTINEL",
  handoffToken: "HANDOFF_TOKEN_SENTINEL",
  questionText: "QUESTION_TEXT_SENTINEL",
  answerText: "ANSWER_TEXT_SENTINEL",
  toolCommand: "TOOL_COMMAND_SENTINEL",
  planContent: "PLAN_CONTENT_SENTINEL",
  errorText: "ERROR_TEXT_SENTINEL",
  titleText: "TITLE_TEXT_SENTINEL",
} as const;

function base({ id, occurredAt }: { id: string; occurredAt: number }) {
  return {
    id,
    aggregateId: CONVERSATION_ID,
    aggregateType: "langy_conversation",
    tenantId: PROJECT_ID,
    createdAt: occurredAt,
    occurredAt,
  };
}

export function conversationStartedEvent(params: {
  id: string;
  occurredAt: number;
}) {
  return LangyConversationStartedEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_STARTED,
    data: {
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
      title: null,
      runToken: SENTINELS.runToken,
    },
  });
}

export function messageRecordedEvent(params: {
  id: string;
  occurredAt: number;
  messageId?: string;
}) {
  return LangyMessageRecordedEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_RECORDED,
    data: {
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
      messageId: params.messageId ?? "msg_user_1",
      role: "user",
      parts: [{ type: "text", text: SENTINELS.questionText }],
      title: SENTINELS.titleText,
    },
  });
}

export function agentTurnAcceptedEvent(params: {
  id: string;
  occurredAt: number;
  turnId: string;
}) {
  return LangyAgentTurnAcceptedEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED,
    data: {
      conversationId: CONVERSATION_ID,
      turnId: params.turnId,
      questionParts: [{ type: "text", text: SENTINELS.questionText }],
    },
  });
}

export function toolCallInitiatedEvent(params: {
  id: string;
  occurredAt: number;
  turnId: string;
  toolCallId?: string;
}) {
  return LangyToolCallInitiatedEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_INITIATED,
    data: {
      conversationId: CONVERSATION_ID,
      turnId: params.turnId,
      toolCallId: params.toolCallId ?? "call_1",
      toolName: "bash",
      command: SENTINELS.toolCommand,
      input: { command: SENTINELS.toolCommand },
    },
  });
}

export function toolCallSucceededEvent(params: {
  id: string;
  occurredAt: number;
  turnId: string;
  toolCallId?: string;
}) {
  return LangyToolCallSucceededEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
    data: {
      conversationId: CONVERSATION_ID,
      turnId: params.turnId,
      toolCallId: params.toolCallId ?? "call_1",
      toolName: "bash",
      command: SENTINELS.toolCommand,
      durationMs: 1234,
    },
  });
}

export function planUpdatedEvent(params: {
  id: string;
  occurredAt: number;
  turnId: string;
}) {
  return LangyPlanUpdatedEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.PLAN_UPDATED,
    data: {
      conversationId: CONVERSATION_ID,
      turnId: params.turnId,
      items: [{ content: SENTINELS.planContent, status: "pending" }],
    },
  });
}

export function agentRespondedEvent(params: {
  id: string;
  occurredAt: number;
  turnId: string;
  outcome?: "completed" | "failed";
}) {
  return LangyAgentRespondedEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
    data: {
      conversationId: CONVERSATION_ID,
      turnId: params.turnId,
      messageId: `msg_${params.turnId}`,
      role: "assistant",
      parts: [{ type: "text", text: SENTINELS.answerText }],
      outcome: params.outcome ?? "completed",
      error: null,
    },
  });
}

export function agentResponseFailedEvent(params: {
  id: string;
  occurredAt: number;
  turnId: string;
}) {
  return LangyAgentResponseFailedEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONSE_FAILED,
    data: {
      conversationId: CONVERSATION_ID,
      turnId: params.turnId,
      error: SENTINELS.errorText,
    },
  });
}

export function conversationArchivedEvent(params: {
  id: string;
  occurredAt: number;
}) {
  return LangyConversationArchivedEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.ARCHIVED,
    data: { conversationId: CONVERSATION_ID },
  });
}

export function conversationRenamedEvent(params: {
  id: string;
  occurredAt: number;
}) {
  return LangyConversationMetadataUpdatedEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.METADATA_UPDATED,
    data: {
      conversationId: CONVERSATION_ID,
      title: SENTINELS.titleText,
    },
  });
}

export function handoffPendingEvent(params: {
  id: string;
  occurredAt: number;
  turnId: string;
}) {
  return LangyConversationHandoffPendingEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_PENDING,
    data: {
      conversationId: CONVERSATION_ID,
      turnId: params.turnId,
      token: SENTINELS.handoffToken,
    },
  });
}

export function handoffConsumedEvent(params: {
  id: string;
  occurredAt: number;
  turnId: string;
}) {
  return LangyConversationHandoffConsumedEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_CONSUMED,
    data: { conversationId: CONVERSATION_ID, turnId: params.turnId },
  });
}

export function titleGeneratedEvent(params: {
  id: string;
  occurredAt: number;
  turnId: string;
}) {
  return LangyConversationTitleGeneratedEventSchema.parse({
    ...base(params),
    type: LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.TITLE_GENERATED,
    data: {
      conversationId: CONVERSATION_ID,
      turnId: params.turnId,
      title: SENTINELS.titleText,
      source: "auto",
      model: "openai/gpt-5-mini",
    },
  });
}
