import { defineCommand } from "../../commands/defineCommand";
import {
  LANGY_CONVERSATION_COMMAND_TYPES,
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "./schemas/constants";
import {
  langyAgentResponseFailedEventDataSchema,
  langyAgentRespondedEventDataSchema,
  langyAgentResponseStartedEventDataSchema,
  langyConversationArchivedEventDataSchema,
  langyConversationContinuedEventDataSchema,
  langyConversationStartedEventDataSchema,
  langyConversationHandoffConsumedEventDataSchema,
  langyConversationHandoffPendingEventDataSchema,
  langyConversationMetadataUpdatedEventDataSchema,
  langyConversationTitleGeneratedEventDataSchema,
  langyToolCallFailedEventDataSchema,
  langyToolCallInitiatedEventDataSchema,
  langyToolCallSucceededEventDataSchema,
} from "./schemas/events";

/**
 * All langy-conversation-processing commands. Each is a pure 1:1 command →
 * event mapping (via defineCommand). Aggregate = `langy_conversation`,
 * aggregateId = conversationId, TenantId = projectId.
 */

/** CreateConversation → conversation_started (explicit creation). */
export const CreateConversationCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.CREATE_CONVERSATION,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_STARTED,
  aggregateType: "langy_conversation",
  schema: langyConversationStartedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) => `${d.tenantId}:${d.conversationId}:created`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
  }),
});

/** ContinueConversation → conversation_continued (the user turn). */
export const ContinueConversationCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.CONTINUE_CONVERSATION,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_CONTINUED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_CONTINUED,
  aggregateType: "langy_conversation",
  schema: langyConversationContinuedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:message:${d.messageId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.message.id": d.messageId,
    "payload.role": d.role,
  }),
});

/** CreateAgentResponse → agent_response_started. */
export const CreateAgentResponseCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.CREATE_AGENT_RESPONSE,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_STARTED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONSE_STARTED,
  aggregateType: "langy_conversation",
  schema: langyAgentResponseStartedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:turn-start:${d.turnId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
  }),
});

// NOTE: status_reported / progress_reported are EPHEMERAL signals, not durable
// commands — they are published to the Redis buffer via LangyEphemeralPublisher
// (see ../ephemeral.ts), never dispatched through this pipeline (ADR-046).
//
// The commands below ARE durable: a meaningful result the agent produces during
// a response (a tool call it ran, an intermediate answer, a hard failure) is
// worth persisting on the event log, unlike a transient "42% through" tick.

/** InitiateToolCall → tool_call_initiated (a durable response milestone). */
export const InitiateToolCallCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.INITIATE_TOOL_CALL,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_INITIATED,
  aggregateType: "langy_conversation",
  schema: langyToolCallInitiatedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:tool-start:${d.toolCallId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
    "payload.tool.name": d.toolName,
  }),
});

/** SucceedToolCall → tool_call_succeeded (a durable response milestone). */
export const SucceedToolCallCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.SUCCEED_TOOL_CALL,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
  aggregateType: "langy_conversation",
  schema: langyToolCallSucceededEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:tool-done:${d.toolCallId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
    "payload.tool.name": d.toolName,
  }),
});

/**
 * FailToolCall → tool_call_failed (a durable response milestone). The failing
 * terminal of a tool call; a call reaches exactly one of succeed/fail, so the
 * idempotency key matches SucceedToolCall's `tool-done` slot — the first
 * terminal for a toolCallId wins and a contradictory second is collapsed.
 */
export const FailToolCallCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.FAIL_TOOL_CALL,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_FAILED,
  aggregateType: "langy_conversation",
  schema: langyToolCallFailedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:tool-done:${d.toolCallId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
    "payload.tool.name": d.toolName,
  }),
});

/**
 * FailAgentResponse → agent_response_failed. The terminal a stalled/orphaned
 * response reaches when there is no answer to carry (the liveness sweep drains
 * it). Distinct from RecordAgentResponse/agent_responded, which carries the
 * completed answer.
 */
export const FailAgentResponseCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.FAIL_AGENT_RESPONSE,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONSE_FAILED,
  aggregateType: "langy_conversation",
  schema: langyAgentResponseFailedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:turn-failed:${d.turnId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
  }),
});

/** RecordAgentResponse → agent_responded (the whole final answer, source of truth). */
export const RecordAgentResponseCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.RECORD_AGENT_RESPONSE,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
  aggregateType: "langy_conversation",
  schema: langyAgentRespondedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:turn-final:${d.turnId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
    "payload.outcome": d.outcome,
  }),
});

/** ArchiveConversation → conversation_archived (soft-delete). */
export const ArchiveConversationCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.ARCHIVE,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.ARCHIVED,
  aggregateType: "langy_conversation",
  schema: langyConversationArchivedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) => `${d.tenantId}:${d.conversationId}:archive`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
  }),
});

/**
 * GenerateConversationTitle → conversation_title_generated (auto title).
 * Dispatched by the langyTitleGeneration reactor after a finalized response.
 * Idempotency is keyed on conversationId + occurredAt so a redelivered
 * dispatch collapses; the reactor's own per-conversation dedup window is the
 * primary throttle (see LANGY_TITLE_GENERATION.COOLDOWN_MS).
 */
export const GenerateConversationTitleCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.GENERATE_TITLE,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TITLE_GENERATED,
  aggregateType: "langy_conversation",
  schema: langyConversationTitleGeneratedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:title:${d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.title.source": d.source,
    "payload.model": d.model,
  }),
});

/**
 * UpdateConversationMetadata → conversation_metadata_updated (rename/share).
 * Beyond the prescribed vocabulary — see ADR-046 open question 1.
 */
export const UpdateConversationMetadataCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.UPDATE_METADATA,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.METADATA_UPDATED,
  aggregateType: "langy_conversation",
  schema: langyConversationMetadataUpdatedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:metadata:${d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
  }),
});

/**
 * RecordTurnHandoff → conversation_handoff_pending (ADR-048). Persists the
 * opaque, worker-authored resume token for a turn that checkpointed on pod
 * termination. Idempotency keyed on the turn so a retried handoff writes one
 * event.
 */
export const RecordTurnHandoffCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.RECORD_TURN_HANDOFF,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_PENDING,
  aggregateType: "langy_conversation",
  schema: langyConversationHandoffPendingEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:handoff:${d.turnId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
  }),
});

/**
 * ConsumeTurnHandoff → conversation_handoff_consumed (ADR-048). Clears the
 * pending token once the next turn has threaded it to a fresh worker.
 * Idempotency keyed on the turn so a double-consume collapses to one event.
 */
export const ConsumeTurnHandoffCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.CONSUME_TURN_HANDOFF,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_CONSUMED,
  aggregateType: "langy_conversation",
  schema: langyConversationHandoffConsumedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:handoff-consumed:${d.turnId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
  }),
});
