/**
 * Event and command type constants for the langy-conversation-processing
 * pipeline (ADR-046). Event-sourced aggregate: `aggregateId` is the
 * conversationId, `TenantId` the projectId.
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
  CONVERSATION_HANDOFF_PENDING: "lw.langy_conversation.conversation_handoff_pending",
  CONVERSATION_HANDOFF_CONSUMED: "lw.langy_conversation.conversation_handoff_consumed",
  // An auto title produced at the first successful agent-response boundary.
  // Distinct from METADATA_UPDATED (a manual, sticky rename): a title_generated
  // event updates the title ONLY when it has not been set by the user.
  TITLE_GENERATED: "lw.langy_conversation.conversation_title_generated",
  // ADR-129 local control: the developer's own folder, shared with one
  // conversation through `langwatch langy --share-control`.
  LOCAL_CONTROL_REQUESTED: "lw.langy_conversation.local_control_requested",
  LOCAL_WORKSPACE_CONNECTED: "lw.langy_conversation.local_workspace_connected",
  LOCAL_WORKSPACE_DISCONNECTED: "lw.langy_conversation.local_workspace_disconnected",
  LOCAL_POLICY_CHANGED: "lw.langy_conversation.local_policy_changed",
  // ADR-129 user waits: one primitive behind the permission card and the
  // question card. The turn stays in flight while the card waits for an answer.
  USER_WAIT_STARTED: "lw.langy_conversation.user_wait_started",
  USER_WAIT_ENDED: "lw.langy_conversation.user_wait_ended",
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
  LANGY_CONVERSATION_EVENT_TYPES.LOCAL_CONTROL_REQUESTED,
  LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_CONNECTED,
  LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_DISCONNECTED,
  LANGY_CONVERSATION_EVENT_TYPES.LOCAL_POLICY_CHANGED,
  LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED,
  LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_ENDED,
] as const;

export type LangyConversationProcessingEventType =
  (typeof LANGY_CONVERSATION_PROCESSING_EVENT_TYPES)[number];

/**
 * EPHEMERAL signal type identifiers — NOT durable events (ADR-046). Flow
 * through a short-lived per-conversation Redis buffer (`../ephemeral.ts`)
 * backing the live UI stream, dropped on turn end or TTL.
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
  // ADR-129 local control and user waits.
  REQUEST_LOCAL_CONTROL: "lw.langy_conversation.request_local_control",
  CONNECT_LOCAL_WORKSPACE: "lw.langy_conversation.connect_local_workspace",
  DISCONNECT_LOCAL_WORKSPACE: "lw.langy_conversation.disconnect_local_workspace",
  CHANGE_LOCAL_POLICY: "lw.langy_conversation.change_local_policy",
  START_USER_WAIT: "lw.langy_conversation.start_user_wait",
  END_USER_WAIT: "lw.langy_conversation.end_user_wait",
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
  LANGY_CONVERSATION_COMMAND_TYPES.REQUEST_LOCAL_CONTROL,
  LANGY_CONVERSATION_COMMAND_TYPES.CONNECT_LOCAL_WORKSPACE,
  LANGY_CONVERSATION_COMMAND_TYPES.DISCONNECT_LOCAL_WORKSPACE,
  LANGY_CONVERSATION_COMMAND_TYPES.CHANGE_LOCAL_POLICY,
  LANGY_CONVERSATION_COMMAND_TYPES.START_USER_WAIT,
  LANGY_CONVERSATION_COMMAND_TYPES.END_USER_WAIT,
] as const;

export type LangyConversationProcessingCommandType =
  (typeof LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES)[number];

/**
 * Conversation lifecycle status held on the fold: `active` (no turn in
 * flight), `running`, `idle` (turn just completed), `failed`, `archived`.
 */
export const LANGY_CONVERSATION_STATUS = {
  ACTIVE: "active",
  RUNNING: "running",
  IDLE: "idle",
  FAILED: "failed",
  ARCHIVED: "archived",
} as const;

/**
 * Where the title came from. Precedence: `user` is sticky and never
 * overridden; `auto` is stable across turns; `derived` is the only one an
 * auto title replaces.
 */
export const LANGY_TITLE_SOURCE = {
  /** First-message placeholder slice (or none yet). */
  DERIVED: "derived",
  /** Produced once by the process-outbox title effect. */
  AUTO: "auto",
  /** Set by the user via the rename (PATCH) route — sticky. */
  USER: "user",
} as const;

export type LangyTitleSource = (typeof LANGY_TITLE_SOURCE)[keyof typeof LANGY_TITLE_SOURCE];

/**
 * Lifecycle status of one turn (langyConversationTurn fold): `pending` (init
 * default), `running`, then exactly one terminal of `completed`/`failed`/
 * `stopped`. `stopped` (ADR-078) keeps the partial answer and anchors Continue.
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
  LOCAL_CONTROL_REQUESTED: "2026-09-02",
  LOCAL_WORKSPACE_CONNECTED: "2026-09-02",
  LOCAL_WORKSPACE_DISCONNECTED: "2026-09-02",
  LOCAL_POLICY_CHANGED: "2026-09-02",
  USER_WAIT_STARTED: "2026-09-02",
  USER_WAIT_ENDED: "2026-09-02",
} as const;

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 */
export const LANGY_CONVERSATION_PROJECTION_VERSIONS = {
  CONVERSATION_STATE: "2026-07-10",
  // Bumped when a tool call in the turn fold gained the `wait` it put in front
  // of the developer (ADR-129 user waits).
  CONVERSATION_TURN: "2026-09-02",
} as const;

/**
 * What a user wait asks for. `permission` is one local command the developer
 * allows or denies; `question` is a choice Langy needs before it goes on.
 */
export const LANGY_USER_WAIT_KINDS = {
  PERMISSION: "permission",
  QUESTION: "question",
} as const;

export type LangyUserWaitKind = (typeof LANGY_USER_WAIT_KINDS)[keyof typeof LANGY_USER_WAIT_KINDS];

/** How a user wait finished. A wait reaches exactly one of these. */
export const LANGY_USER_WAIT_OUTCOMES = {
  ANSWERED: "answered",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
} as const;

export type LangyUserWaitOutcome =
  (typeof LANGY_USER_WAIT_OUTCOMES)[keyof typeof LANGY_USER_WAIT_OUTCOMES];

/** What the developer answered on a permission card. */
export const LANGY_PERMISSION_DECISIONS = {
  ALLOW_ONCE: "allow_once",
  ALLOW_PATTERN: "allow_pattern",
  DENY: "deny",
} as const;

export type LangyPermissionDecision =
  (typeof LANGY_PERMISSION_DECISIONS)[keyof typeof LANGY_PERMISSION_DECISIONS];
