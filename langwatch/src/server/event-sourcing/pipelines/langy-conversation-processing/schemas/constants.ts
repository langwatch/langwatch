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
  AGENT_TURN_FAILED: "lw.langy_conversation.agent_turn_failed",
  TURN_FINALIZED: "lw.langy_conversation.turn_finalized",
  ARCHIVED: "lw.langy_conversation.conversation_archived",
  // Beyond the prescribed vocabulary — preserves the PATCH rename/share route.
  // See ADR-046 open question 1.
  METADATA_UPDATED: "lw.langy_conversation.conversation_metadata_updated",
  // ADR-048 shutdown-handoff: a turn checkpointed on pod termination and left an
  // opaque, worker-authored resume token for the next turn to pick up
  // (CONVERSATION_HANDOFF_PENDING); the next turn threaded it to a fresh worker
  // and cleared it (CONVERSATION_HANDOFF_CONSUMED).
  CONVERSATION_HANDOFF_PENDING: "lw.langy_conversation.conversation_handoff_pending",
  CONVERSATION_HANDOFF_CONSUMED: "lw.langy_conversation.conversation_handoff_consumed",
  // An auto title produced by the cheap-model regeneration reactor. Distinct
  // from METADATA_UPDATED (a manual, sticky rename): a title_generated event
  // updates the title ONLY when it has not been set by the user.
  TITLE_GENERATED: "lw.langy_conversation.conversation_title_generated",
} as const;

export const LANGY_CONVERSATION_PROCESSING_EVENT_TYPES = [
  LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_SENT,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_STARTED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_STARTED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_COMPLETED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_FAILED,
  LANGY_CONVERSATION_EVENT_TYPES.TURN_FINALIZED,
  LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
  LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
  LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
  LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
  LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED,
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
  // PR3 turn-lifecycle write surface. The durable milestones the streaming
  // worker records during a turn (ADR-044): a meaningful result the agent
  // produces is a durable event; transient progress ticks stay ephemeral.
  RECORD_TOOL_CALL_STARTED: "lw.langy_conversation.record_tool_call_started",
  RECORD_TOOL_CALL_COMPLETED: "lw.langy_conversation.record_tool_call_completed",
  FAIL_AGENT_TURN: "lw.langy_conversation.fail_agent_turn",
  RECONCILE_AGENT_TURN: "lw.langy_conversation.reconcile_agent_turn",
  ARCHIVE: "lw.langy_conversation.archive_conversation",
  UPDATE_METADATA: "lw.langy_conversation.update_metadata",
  // ADR-048 shutdown-handoff write surface.
  RECORD_TURN_HANDOFF: "lw.langy_conversation.record_turn_handoff",
  CONSUME_TURN_HANDOFF: "lw.langy_conversation.consume_turn_handoff",
  // Dispatched by the cheap-model regeneration reactor (1:1 → title_generated).
  GENERATE_TITLE: "lw.langy_conversation.generate_conversation_title",
} as const;

export const LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES = [
  LANGY_CONVERSATION_COMMAND_TYPES.SEND_MESSAGE,
  LANGY_CONVERSATION_COMMAND_TYPES.START_AGENT_TURN,
  LANGY_CONVERSATION_COMMAND_TYPES.RECORD_TOOL_CALL_STARTED,
  LANGY_CONVERSATION_COMMAND_TYPES.RECORD_TOOL_CALL_COMPLETED,
  LANGY_CONVERSATION_COMMAND_TYPES.FAIL_AGENT_TURN,
  LANGY_CONVERSATION_COMMAND_TYPES.RECONCILE_AGENT_TURN,
  LANGY_CONVERSATION_COMMAND_TYPES.ARCHIVE,
  LANGY_CONVERSATION_COMMAND_TYPES.UPDATE_METADATA,
  LANGY_CONVERSATION_COMMAND_TYPES.RECORD_TURN_HANDOFF,
  LANGY_CONVERSATION_COMMAND_TYPES.CONSUME_TURN_HANDOFF,
  LANGY_CONVERSATION_COMMAND_TYPES.GENERATE_TITLE,
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
 * Where the conversation's current title came from. The fold keeps this so both
 * the fold handlers and the regeneration reactor can enforce the precedence:
 * a `user` title is sticky and never overridden; an `auto` title may be
 * refined by a later regeneration; a `derived` placeholder is the first thing
 * an auto title replaces.
 */
export const LANGY_TITLE_SOURCE = {
  /** First-message placeholder slice (or none yet). */
  DERIVED: "derived",
  /** Produced by the cheap-model regeneration reactor. */
  AUTO: "auto",
  /** Set by the user via the rename (PATCH) route — sticky. */
  USER: "user",
} as const;

export type LangyTitleSource =
  (typeof LANGY_TITLE_SOURCE)[keyof typeof LANGY_TITLE_SOURCE];

/**
 * Throttle + shape policy for auto title regeneration (the
 * langyTitleGeneration reactor). Regenerate once after the first finalized
 * turn (while the title is still a derived placeholder), then only every N
 * turns so we do not pay for a title model call on every turn. A per-
 * conversation dedup window is a cooldown backstop against bursts.
 */
export const LANGY_TITLE_GENERATION = {
  /** Cheap, capable default — the whole point is a low-cost title call. */
  MODEL: "openai/gpt-5-mini",
  /** Soft character budget for the generated title. */
  MAX_TITLE_CHARS: 60,
  /** Recent messages fed to the title prompt. */
  PROMPT_MESSAGE_LIMIT: 8,
  /** Per-message truncation so a long turn cannot blow up the prompt. */
  PROMPT_CHARS_PER_MESSAGE: 500,
  /** After the first auto title, only refine every Nth finalized turn. */
  REGENERATE_EVERY_N_TURNS: 3,
  /**
   * Reactor dedup window (ms): collapses repeat regenerations for the same
   * conversation, and also dedups a redelivered `turn_finalized`. Acts as the
   * time-based cooldown alongside the every-N-turns count gate.
   */
  COOLDOWN_MS: 60_000,
} as const;

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD).
 */
export const LANGY_CONVERSATION_EVENT_VERSIONS = {
  MESSAGE_SENT: "2026-07-10",
  AGENT_TURN_STARTED: "2026-07-10",
  TOOL_CALL_STARTED: "2026-07-10",
  TOOL_CALL_COMPLETED: "2026-07-10",
  AGENT_TURN_FAILED: "2026-07-10",
  TURN_FINALIZED: "2026-07-10",
  ARCHIVED: "2026-07-10",
  METADATA_UPDATED: "2026-07-10",
  CONVERSATION_HANDOFF_PENDING: "2026-07-11",
  CONVERSATION_HANDOFF_CONSUMED: "2026-07-11",
  TITLE_GENERATED: "2026-07-11",
} as const;

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 */
export const LANGY_CONVERSATION_PROJECTION_VERSIONS = {
  CONVERSATION_STATE: "2026-07-10",
} as const;
