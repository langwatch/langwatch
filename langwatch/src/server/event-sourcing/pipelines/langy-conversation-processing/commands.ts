import { defineCommand } from "../../commands/defineCommand";
import {
  LANGY_CONVERSATION_COMMAND_TYPES,
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "./schemas/constants";
import {
  langyAgentRespondedEventDataSchema,
  langyAgentTurnFailedEventDataSchema,
  langyConversationArchivedEventDataSchema,
  langyConversationHandoffConsumedEventDataSchema,
  langyConversationHandoffPendingEventDataSchema,
  langyConversationMetadataUpdatedEventDataSchema,
  langyAgentTurnStartedEventDataSchema,
  langyMessageSentEventDataSchema,
  langyToolCallCompletedEventDataSchema,
  langyToolCallStartedEventDataSchema,
  langyTurnFinalizedEventDataSchema,
} from "./schemas/events";

/**
 * All langy-conversation-processing commands. Each is a pure 1:1 command →
 * event mapping (via defineCommand). Aggregate = `langy_conversation`,
 * aggregateId = conversationId, TenantId = projectId.
 */

/** SendMessage → message_sent (the user turn). */
export const SendMessageCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.SEND_MESSAGE,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_SENT,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_SENT,
  aggregateType: "langy_conversation",
  schema: langyMessageSentEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:message:${d.messageId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.message.id": d.messageId,
    "payload.role": d.role,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.conversationId}:message:${d.messageId}`,
});

/** StartAgentTurn → agent_turn_started. */
export const StartAgentTurnCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.START_AGENT_TURN,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_STARTED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_STARTED,
  aggregateType: "langy_conversation",
  schema: langyAgentTurnStartedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:turn-start:${d.turnId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.conversationId}:turn-start:${d.turnId}`,
});

// NOTE: status_reported / progress_reported are EPHEMERAL signals, not durable
// commands — they are published to the Redis buffer via LangyEphemeralPublisher
// (see ../ephemeral.ts), never dispatched through this pipeline (ADR-046).
//
// The commands below ARE durable: a meaningful result the agent produces during
// a turn (a tool call it ran, an intermediate answer, a hard failure) is worth
// persisting on the event log, unlike a transient "42% through" progress tick.

/** RecordToolCallStarted → tool_call_started (a durable turn milestone). */
export const RecordToolCallStartedCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.RECORD_TOOL_CALL_STARTED,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_STARTED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_STARTED,
  aggregateType: "langy_conversation",
  schema: langyToolCallStartedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:tool-start:${d.toolCallId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
    "payload.tool.name": d.toolName,
  }),
  makeJobId: (d) =>
    `${d.tenantId}:${d.conversationId}:tool-start:${d.toolCallId}`,
});

/** RecordToolCallCompleted → tool_call_completed (a durable turn milestone). */
export const RecordToolCallCompletedCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.RECORD_TOOL_CALL_COMPLETED,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_COMPLETED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_COMPLETED,
  aggregateType: "langy_conversation",
  schema: langyToolCallCompletedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:tool-done:${d.toolCallId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
    "payload.tool.name": d.toolName,
  }),
  makeJobId: (d) =>
    `${d.tenantId}:${d.conversationId}:tool-done:${d.toolCallId}`,
});

/** RecordAgentResponded → agent_responded (an intermediate assistant response). */
export const RecordAgentRespondedCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.RECORD_AGENT_RESPONDED,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
  aggregateType: "langy_conversation",
  schema: langyAgentRespondedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:responded:${d.turnId}:${d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
  }),
  makeJobId: (d) =>
    `${d.tenantId}:${d.conversationId}:responded:${d.turnId}:${d.occurredAt}`,
});

/**
 * FailAgentTurn → agent_turn_failed. The terminal a stalled/orphaned turn
 * reaches when there is no answer to carry (reconcile + drain). Distinct from
 * ReconcileAgentTurn/turn_finalized, which carries the completed answer.
 */
export const FailAgentTurnCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.FAIL_AGENT_TURN,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_FAILED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_FAILED,
  aggregateType: "langy_conversation",
  schema: langyAgentTurnFailedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:turn-failed:${d.turnId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.conversationId}:turn-failed:${d.turnId}`,
});

/** ReconcileAgentTurn → turn_finalized (the whole final answer, source of truth). */
export const ReconcileAgentTurnCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.RECONCILE_AGENT_TURN,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.TURN_FINALIZED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TURN_FINALIZED,
  aggregateType: "langy_conversation",
  schema: langyTurnFinalizedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:turn-final:${d.turnId}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.turn.id": d.turnId,
    "payload.outcome": d.outcome,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.conversationId}:turn-final:${d.turnId}`,
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
  makeJobId: (d) => `${d.tenantId}:${d.conversationId}:archive`,
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
  makeJobId: (d) =>
    `${d.tenantId}:${d.conversationId}:metadata:${d.occurredAt}`,
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
  makeJobId: (d) => `${d.tenantId}:${d.conversationId}:handoff:${d.turnId}`,
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
  makeJobId: (d) =>
    `${d.tenantId}:${d.conversationId}:handoff-consumed:${d.turnId}`,
});
