import { defineCommand } from "../../commands/defineCommand";
import {
  LANGY_CONVERSATION_COMMAND_TYPES,
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "./schemas/constants";
import {
  langyConversationArchivedEventDataSchema,
  langyConversationMetadataUpdatedEventDataSchema,
  langyAgentTurnStartedEventDataSchema,
  langyMessageSentEventDataSchema,
  langyProgressReportedEventDataSchema,
  langyStatusReportedEventDataSchema,
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

/** ReportStatus → status_reported (worker heartbeat; PR3 caller). */
export const ReportStatusCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.REPORT_STATUS,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.STATUS_REPORTED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.STATUS_REPORTED,
  aggregateType: "langy_conversation",
  schema: langyStatusReportedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:status:${d.turnId ?? ""}:${d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
    "payload.status": d.status,
  }),
  makeJobId: (d) =>
    `${d.tenantId}:${d.conversationId}:status:${d.turnId ?? ""}:${d.occurredAt}`,
});

/** ReportProgress → progress_reported (worker progress; PR3 caller). */
export const ReportProgressCommand = defineCommand({
  commandType: LANGY_CONVERSATION_COMMAND_TYPES.REPORT_PROGRESS,
  eventType: LANGY_CONVERSATION_EVENT_TYPES.PROGRESS_REPORTED,
  eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.PROGRESS_REPORTED,
  aggregateType: "langy_conversation",
  schema: langyProgressReportedEventDataSchema,
  aggregateId: (d) => d.conversationId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.conversationId}:progress:${d.turnId ?? ""}:${d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.conversation.id": d.conversationId,
  }),
  makeJobId: (d) =>
    `${d.tenantId}:${d.conversationId}:progress:${d.turnId ?? ""}:${d.occurredAt}`,
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
 * Beyond the prescribed vocabulary — see ADR-043 open question 1.
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
