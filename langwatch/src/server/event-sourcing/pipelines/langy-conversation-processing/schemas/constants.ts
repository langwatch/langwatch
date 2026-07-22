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
  CONVERSATION_STARTED: "lw.langy_conversation.conversation_started",
  CONVERSATION_FORKED: "lw.langy_conversation.conversation_forked",
  MESSAGE_RECORDED: "lw.langy_conversation.message_recorded",
  MESSAGE_IMPORTED: "lw.langy_conversation.message_imported",
  AGENT_TURN_ACCEPTED: "lw.langy_conversation.agent_turn_accepted",
  TOOL_CALL_INITIATED: "lw.langy_conversation.tool_call_initiated",
  TOOL_CALL_SUCCEEDED: "lw.langy_conversation.tool_call_succeeded",
  TOOL_CALL_FAILED: "lw.langy_conversation.tool_call_failed",
  // A full snapshot of the agent's plan (todo list) during a turn. Snapshot-
  // typed, last-write-wins on the turn fold — one durable record of the plan
  // that survives reload alongside the tool parts it was derived from.
  PLAN_UPDATED: "lw.langy_conversation.plan_updated",
  AGENT_RESPONSE_FAILED: "lw.langy_conversation.agent_response_failed",
  AGENT_RESPONDED: "lw.langy_conversation.agent_responded",
  ARCHIVED: "lw.langy_conversation.conversation_archived",
  // Beyond the prescribed vocabulary — preserves the PATCH rename/share route.
  // See ADR-046 open question 1.
  METADATA_UPDATED: "lw.langy_conversation.conversation_metadata_updated",
  // ADR-048 shutdown-handoff: a turn checkpointed on pod termination and left an
  // opaque, worker-authored resume token for the next turn to pick up
  // (CONVERSATION_HANDOFF_PENDING); the next turn threaded it to a fresh worker
  // and cleared it (CONVERSATION_HANDOFF_CONSUMED).
  CONVERSATION_HANDOFF_PENDING:
    "lw.langy_conversation.conversation_handoff_pending",
  CONVERSATION_HANDOFF_CONSUMED:
    "lw.langy_conversation.conversation_handoff_consumed",
  // An auto title produced at the first successful agent-response boundary.
  // Distinct from METADATA_UPDATED (a manual, sticky rename): a title_generated
  // event updates the title ONLY when it has not been set by the user.
  TITLE_GENERATED: "lw.langy_conversation.conversation_title_generated",
} as const;

export const LANGY_CONVERSATION_PROCESSING_EVENT_TYPES = [
  LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
  LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED,
  LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
  LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
  LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
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

/**
 * DURABLE command type identifiers. Ephemeral signals are NOT commands — they
 * are published to the Redis buffer, not dispatched through the pipeline.
 * Format: "lw.langy_conversation.<action>".
 */
export const LANGY_CONVERSATION_COMMAND_TYPES = {
  CREATE_CONVERSATION: "lw.langy_conversation.create_conversation",
  FORK_CONVERSATION: "lw.langy_conversation.fork_conversation",
  RECORD_MESSAGE: "lw.langy_conversation.record_message",
  IMPORT_MESSAGE: "lw.langy_conversation.import_message",
  ACCEPT_AGENT_TURN: "lw.langy_conversation.accept_agent_turn",
  // Turn-lifecycle write surface. The durable milestones the agent records
  // during a response (ADR-044): a meaningful result the agent produces is a
  // durable event; transient progress ticks stay ephemeral. A tool call is
  // initiated, then reaches exactly one terminal — succeeded or failed.
  INITIATE_TOOL_CALL: "lw.langy_conversation.initiate_tool_call",
  SUCCEED_TOOL_CALL: "lw.langy_conversation.succeed_tool_call",
  FAIL_TOOL_CALL: "lw.langy_conversation.fail_tool_call",
  UPDATE_PLAN: "lw.langy_conversation.update_plan",
  FAIL_AGENT_RESPONSE: "lw.langy_conversation.fail_agent_response",
  RECORD_AGENT_RESPONSE: "lw.langy_conversation.record_agent_response",
  ARCHIVE: "lw.langy_conversation.archive_conversation",
  UPDATE_METADATA: "lw.langy_conversation.update_metadata",
  // ADR-048 shutdown-handoff write surface.
  RECORD_TURN_HANDOFF: "lw.langy_conversation.record_turn_handoff",
  CONSUME_TURN_HANDOFF: "lw.langy_conversation.consume_turn_handoff",
  // Dispatched by the process-outbox title effect (1:1 → title_generated).
  GENERATE_TITLE: "lw.langy_conversation.generate_conversation_title",
} as const;

export const LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES = [
  LANGY_CONVERSATION_COMMAND_TYPES.CREATE_CONVERSATION,
  LANGY_CONVERSATION_COMMAND_TYPES.FORK_CONVERSATION,
  LANGY_CONVERSATION_COMMAND_TYPES.RECORD_MESSAGE,
  LANGY_CONVERSATION_COMMAND_TYPES.IMPORT_MESSAGE,
  LANGY_CONVERSATION_COMMAND_TYPES.ACCEPT_AGENT_TURN,
  LANGY_CONVERSATION_COMMAND_TYPES.INITIATE_TOOL_CALL,
  LANGY_CONVERSATION_COMMAND_TYPES.SUCCEED_TOOL_CALL,
  LANGY_CONVERSATION_COMMAND_TYPES.FAIL_TOOL_CALL,
  LANGY_CONVERSATION_COMMAND_TYPES.UPDATE_PLAN,
  LANGY_CONVERSATION_COMMAND_TYPES.FAIL_AGENT_RESPONSE,
  LANGY_CONVERSATION_COMMAND_TYPES.RECORD_AGENT_RESPONSE,
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
 * Where the conversation's current title came from. Operational projection
 * handlers enforce precedence: a `user` title is sticky and never overridden;
 * an `auto` title is stable across later turns; a `derived` placeholder is the
 * only thing an auto title replaces.
 */
export const LANGY_TITLE_SOURCE = {
  /** First-message placeholder slice (or none yet). */
  DERIVED: "derived",
  /** Produced once by the process-outbox title effect. */
  AUTO: "auto",
  /** Set by the user via the rename (PATCH) route — sticky. */
  USER: "user",
} as const;

export type LangyTitleSource =
  (typeof LANGY_TITLE_SOURCE)[keyof typeof LANGY_TITLE_SOURCE];

/**
 * Lifecycle status of a single turn, held on the langyConversationTurn fold —
 * the per-turn render document. `pending` = the turn document exists but the
 * agent has not started (init default); `running` = the agent is working;
 * `completed`/`failed`/`stopped` = terminal. A turn reaches exactly one terminal.
 *
 * `stopped` is a user-initiated stop (ADR-058): the agent was mid-answer and the
 * user halted it, so the turn keeps the partial answer it had written and renders
 * distinctly from both a clean `completed` and a red `failed` — it is the anchor
 * for the Continue affordance. It is the render-doc face of an `agent_responded`
 * whose `outcome` is `stopped`; the conversation spine simply reads it as idle.
 */
export const LANGY_CONVERSATION_TURN_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  STOPPED: "stopped",
} as const;

export type LangyConversationTurnStatus =
  (typeof LANGY_CONVERSATION_TURN_STATUS)[keyof typeof LANGY_CONVERSATION_TURN_STATUS];

/**
 * Status of one tool call inside a turn's `ToolCalls` list. Initiated, then
 * exactly one terminal (succeeded/failed) — mirrors the durable tool-call events.
 */
export const LANGY_TURN_TOOL_CALL_STATUS = {
  INITIATED: "initiated",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;

export type LangyTurnToolCallStatus =
  (typeof LANGY_TURN_TOOL_CALL_STATUS)[keyof typeof LANGY_TURN_TOOL_CALL_STATUS];

/**
 * Model and prompt shape for the automatic title. Eligibility is a domain-state
 * transition (`derived` → `auto`) at a successful agent-response boundary; no
 * message counter, timer, or cooldown decides when generation runs.
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
} as const;

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD).
 */
export const LANGY_CONVERSATION_EVENT_VERSIONS = {
  CONVERSATION_STARTED: "2026-07-12",
  CONVERSATION_FORKED: "2026-07-16",
  MESSAGE_RECORDED: "2026-07-10",
  MESSAGE_IMPORTED: "2026-07-16",
  AGENT_TURN_ACCEPTED: "2026-07-10",
  TOOL_CALL_INITIATED: "2026-07-10",
  TOOL_CALL_SUCCEEDED: "2026-07-10",
  TOOL_CALL_FAILED: "2026-07-12",
  PLAN_UPDATED: "2026-07-15",
  AGENT_RESPONSE_FAILED: "2026-07-10",
  AGENT_RESPONDED: "2026-07-10",
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
  // Bumped when the turn fold gained its `Plan` field (plan_updated).
  CONVERSATION_TURN: "2026-07-15",
} as const;
