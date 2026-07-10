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
 * Event type identifiers used for routing and filtering events.
 * Format: "lw.langy_conversation.<action>"
 */
export const LANGY_CONVERSATION_EVENT_TYPES = {
  MESSAGE_SENT: "lw.langy_conversation.message_sent",
  AGENT_TURN_STARTED: "lw.langy_conversation.agent_turn_started",
  TOOL_CALL_STARTED: "lw.langy_conversation.tool_call_started",
  TOOL_CALL_COMPLETED: "lw.langy_conversation.tool_call_completed",
  AGENT_RESPONDED: "lw.langy_conversation.agent_responded",
  AGENT_TURN_COMPLETED: "lw.langy_conversation.agent_turn_completed",
  AGENT_TURN_FAILED: "lw.langy_conversation.agent_turn_failed",
  STATUS_REPORTED: "lw.langy_conversation.status_reported",
  PROGRESS_REPORTED: "lw.langy_conversation.progress_reported",
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
  LANGY_CONVERSATION_EVENT_TYPES.STATUS_REPORTED,
  LANGY_CONVERSATION_EVENT_TYPES.PROGRESS_REPORTED,
  LANGY_CONVERSATION_EVENT_TYPES.TURN_FINALIZED,
  LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
  LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
] as const;

export type LangyConversationProcessingEventType =
  (typeof LANGY_CONVERSATION_PROCESSING_EVENT_TYPES)[number];

/**
 * Command type identifiers used for routing commands to handlers.
 * Format: "lw.langy_conversation.<action>"
 */
export const LANGY_CONVERSATION_COMMAND_TYPES = {
  SEND_MESSAGE: "lw.langy_conversation.send_message",
  START_AGENT_TURN: "lw.langy_conversation.start_agent_turn",
  REPORT_STATUS: "lw.langy_conversation.report_status",
  REPORT_PROGRESS: "lw.langy_conversation.report_progress",
  RECONCILE_AGENT_TURN: "lw.langy_conversation.reconcile_agent_turn",
  ARCHIVE: "lw.langy_conversation.archive_conversation",
  UPDATE_METADATA: "lw.langy_conversation.update_metadata",
} as const;

export const LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES = [
  LANGY_CONVERSATION_COMMAND_TYPES.SEND_MESSAGE,
  LANGY_CONVERSATION_COMMAND_TYPES.START_AGENT_TURN,
  LANGY_CONVERSATION_COMMAND_TYPES.REPORT_STATUS,
  LANGY_CONVERSATION_COMMAND_TYPES.REPORT_PROGRESS,
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
 * Ephemeral event classification (proposed direction — see ADR-046).
 *
 * Some events are pure LIVENESS/transport signals: they carry no state the
 * conversation needs after the turn ends, and persisting one per tick (or, in
 * PR3, per streamed token) would flood the durable `event_log`. These are
 * "ephemeral events": SAME event vocabulary and command surface as durable
 * events, but PR3 will route them to a short-lived, per-aggregate Redis buffer
 * (TTL'd) that backs the live UI transport, instead of appending them to
 * `event_log` / projecting them to ClickHouse.
 *
 * Because ephemeral events are not replayed, the fold must only let them touch
 * transient "live" fields (here: `LastHeartbeatAt`); on replay they are simply
 * absent and that field resets to null harmlessly — no durable state depends on
 * them.
 *
 * The same durable/ephemeral split applies to simulations
 * (`text_message_start` / `text_message_end` / `message_snapshot` flood
 * `simulation_runs` today), so this classification is a candidate to graduate
 * to a framework-level concept shared across pipelines rather than staying
 * Langy-local.
 */
export const LANGY_EPHEMERAL_EVENT_TYPES = [
  LANGY_CONVERSATION_EVENT_TYPES.STATUS_REPORTED,
  LANGY_CONVERSATION_EVENT_TYPES.PROGRESS_REPORTED,
] as const;

export function isEphemeralLangyConversationEventType(type: string): boolean {
  return (LANGY_EPHEMERAL_EVENT_TYPES as readonly string[]).includes(type);
}

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
  STATUS_REPORTED: "2026-07-10",
  PROGRESS_REPORTED: "2026-07-10",
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
