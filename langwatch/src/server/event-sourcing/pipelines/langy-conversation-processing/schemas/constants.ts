/**
 * Event and command type constants for the langy-conversation-processing
 * pipeline (ADR-046).
 *
 * A Langy conversation is an event-sourced aggregate: `aggregateId` is the
 * conversationId and `TenantId` is the projectId. Writes are imperative
 * commands that emit past-tense events; the conversation row and its message
 * rows are both derived projections.
 */

/**
 * DURABLE event type identifiers — written to `event_log` and consumed by the
 * fold / map projections. Format: "lw.langy_conversation.<action>".
 */
export const LANGY_CONVERSATION_EVENT_TYPES = {
  MESSAGE_SENT: "lw.langy_conversation.message_sent",
  AGENT_TURN_STARTED: "lw.langy_conversation.agent_turn_started",
  TOOL_CALL_STARTED: "lw.langy_conversation.tool_call_started",
  TOOL_CALL_COMPLETED: "lw.langy_conversation.tool_call_completed",
  AGENT_RESPONDED: "lw.langy_conversation.agent_responded",
  AGENT_TURN_COMPLETED: "lw.langy_conversation.agent_turn_completed",
  AGENT_TURN_FAILED: "lw.langy_conversation.agent_turn_failed",
  TURN_FINALIZED: "lw.langy_conversation.turn_finalized",
  ARCHIVED: "lw.langy_conversation.conversation_archived",
  // Beyond the prescribed vocabulary — preserves the PATCH rename/share route.
  // See ADR-046 open question 1.
  METADATA_UPDATED: "lw.langy_conversation.conversation_metadata_updated",
} as const;

export const LANGY_CONVERSATION_PROCESSING_EVENT_TYPES = [
  LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_SENT,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_STARTED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_STARTED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_COMPLETED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_COMPLETED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_FAILED,
  LANGY_CONVERSATION_EVENT_TYPES.TURN_FINALIZED,
  LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
  LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
] as const;

export type LangyConversationProcessingEventType =
  (typeof LANGY_CONVERSATION_PROCESSING_EVENT_TYPES)[number];

/**
 * EPHEMERAL signal type identifiers — NOT durable events. They are never
 * written to `event_log`, the fold, or the map projection (ADR-046). They flow
 * through a short-lived, per-conversation Redis buffer (see `../ephemeral.ts`)
 * that backs the live UI stream, and are dropped when the turn ends or the TTL
 * lapses. Persisting one per tick/token would flood `event_log` and leave a
 * residue no consumer wants — so they simply do not enter the durable pipeline.
 *
 * The same durable/ephemeral split applies to simulations
 * (`text_message_start` / `text_message_end` / `message_snapshot` flood
 * `simulation_runs` today), so this classification is a candidate to graduate
 * to a framework-level concept shared across pipelines (ADR-046 open question 4).
 */
export const LANGY_EPHEMERAL_SIGNAL_TYPES = {
  STATUS_REPORTED: "lw.langy_conversation.status_reported",
  PROGRESS_REPORTED: "lw.langy_conversation.progress_reported",
} as const;

export const LANGY_EPHEMERAL_EVENT_TYPES = [
  LANGY_EPHEMERAL_SIGNAL_TYPES.STATUS_REPORTED,
  LANGY_EPHEMERAL_SIGNAL_TYPES.PROGRESS_REPORTED,
] as const;

export function isEphemeralLangyConversationEventType(type: string): boolean {
  return (LANGY_EPHEMERAL_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * DURABLE command type identifiers. Ephemeral signals are NOT commands — they
 * are published to the Redis buffer, not dispatched through the pipeline.
 * Format: "lw.langy_conversation.<action>".
 */
export const LANGY_CONVERSATION_COMMAND_TYPES = {
  SEND_MESSAGE: "lw.langy_conversation.send_message",
  START_AGENT_TURN: "lw.langy_conversation.start_agent_turn",
  RECONCILE_AGENT_TURN: "lw.langy_conversation.reconcile_agent_turn",
  ARCHIVE: "lw.langy_conversation.archive_conversation",
  UPDATE_METADATA: "lw.langy_conversation.update_metadata",
} as const;

export const LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES = [
  LANGY_CONVERSATION_COMMAND_TYPES.SEND_MESSAGE,
  LANGY_CONVERSATION_COMMAND_TYPES.START_AGENT_TURN,
  LANGY_CONVERSATION_COMMAND_TYPES.RECONCILE_AGENT_TURN,
  LANGY_CONVERSATION_COMMAND_TYPES.ARCHIVE,
  LANGY_CONVERSATION_COMMAND_TYPES.UPDATE_METADATA,
] as const;

export type LangyConversationProcessingCommandType =
  (typeof LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES)[number];

/**
 * Conversation lifecycle status values held on the fold.
 * `active` = has messages, no turn in flight; `running` = an agent turn is in
 * progress; `idle` = a turn just completed; `failed` = the last turn failed;
 * `archived` = soft-deleted.
 */
export const LANGY_CONVERSATION_STATUS = {
  ACTIVE: "active",
  RUNNING: "running",
  IDLE: "idle",
  FAILED: "failed",
  ARCHIVED: "archived",
} as const;

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD).
 */
export const LANGY_CONVERSATION_EVENT_VERSIONS = {
  MESSAGE_SENT: "2026-07-10",
  AGENT_TURN_STARTED: "2026-07-10",
  TOOL_CALL_STARTED: "2026-07-10",
  TOOL_CALL_COMPLETED: "2026-07-10",
  AGENT_RESPONDED: "2026-07-10",
  AGENT_TURN_COMPLETED: "2026-07-10",
  AGENT_TURN_FAILED: "2026-07-10",
  TURN_FINALIZED: "2026-07-10",
  ARCHIVED: "2026-07-10",
  METADATA_UPDATED: "2026-07-10",
} as const;

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 */
export const LANGY_CONVERSATION_PROJECTION_VERSIONS = {
  CONVERSATION_STATE: "2026-07-10",
} as const;
