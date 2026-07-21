import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "./constants";
import {
  langyJsonValueSchema,
  langyMessagePartSchema,
  langyMessageRoleSchema,
} from "./shared";

/**
 * ConversationStarted — an explicit conversation-creation event. Sets the owner
 * (first-writer-wins) and, optionally, an initial title, BEFORE any message.
 * Distinct from `message_recorded` (which also lazily creates on the fold
 * for robustness): a `create → then message` flow emits this first, so an empty
 * conversation can exist. Feeds the conversation spine fold only — no message
 * row, no turn document (it is not turn-scoped).
 */
export const langyConversationStartedEventDataSchema = z.object({
  conversationId: z.string(),
  /** Owner of the conversation. Set once (first-writer-wins). */
  userId: z.string(),
  /** Optional initial title (else derived from the first message). */
  title: z.string().nullable().optional(),
  /**
   * The per-conversation `runToken` (LANGY_WORKER_REDESIGN_PLAN §0a): a 32-byte
   * CSPRNG secret (hex) minted here, injected into the worker at spawn, and used
   * to HMAC every frame the worker streams back. SERVER-ONLY — it is folded into
   * a server-only state column (never a client-facing projection or the turn
   * render doc) and never re-sent on the wire. Nullable/optional so events
   * predating this field, and lazily-created conversations, still replay.
   */
  runToken: z.string().nullable().optional(),
});
export type LangyConversationStartedEventData = z.infer<
  typeof langyConversationStartedEventDataSchema
>;

export const LangyConversationStartedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_STARTED),
  data: langyConversationStartedEventDataSchema,
});
export type LangyConversationStartedEvent = z.infer<
  typeof LangyConversationStartedEventSchema
>;

/**
 * ConversationForked — a fresh user-owned aggregate branched from a visible
 * conversation. The source id is durable lineage in the event log; imported
 * transcript rows arrive as explicit `message_imported` events so a replay can
 * rebuild the new conversation without reading the source projection again.
 */
export const langyConversationForkedEventDataSchema = z.object({
  conversationId: z.string(),
  sourceConversationId: z.string(),
  userId: z.string(),
  title: z.string().nullable(),
  runToken: z.string(),
});
export type LangyConversationForkedEventData = z.infer<
  typeof langyConversationForkedEventDataSchema
>;

export const LangyConversationForkedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_FORKED),
  data: langyConversationForkedEventDataSchema,
});
export type LangyConversationForkedEvent = z.infer<
  typeof LangyConversationForkedEventSchema
>;

/**
 * MessageRecorded — a user (or system) message was added to the
 * conversation. Feeds both operational conversation state (owner, title,
 * activity, count) and the message projection. `parts` is opaque to the pipeline.
 *
 */
export const langyMessageRecordedEventDataSchema = z.object({
  conversationId: z.string(),
  /** Owner of the conversation. Set from the first message only. */
  userId: z.string(),
  messageId: z.string(),
  role: langyMessageRoleSchema,
  parts: z.array(langyMessagePartSchema).default([]),
  /** Derived from the first user message; operational state keeps the first non-empty. */
  title: z.string().nullable().optional(),
});
export type LangyMessageRecordedEventData = z.infer<
  typeof langyMessageRecordedEventDataSchema
>;

export const LangyMessageRecordedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_RECORDED),
  data: langyMessageRecordedEventDataSchema,
});
export type LangyMessageRecordedEvent = z.infer<
  typeof LangyMessageRecordedEventSchema
>;

/**
 * MessageImported — one immutable message copied into a fork. It is distinct
 * from `message_recorded` and `agent_responded`: importing history must
 * not start a turn, trigger title generation, or pretend the agent responded
 * again. New message ids keep the fork independent; source ids preserve audit
 * lineage.
 */
export const langyMessageImportedEventDataSchema = z.object({
  conversationId: z.string(),
  sourceConversationId: z.string(),
  sourceMessageId: z.string(),
  messageId: z.string(),
  role: langyMessageRoleSchema,
  parts: z.array(langyMessagePartSchema).default([]),
});
export type LangyMessageImportedEventData = z.infer<
  typeof langyMessageImportedEventDataSchema
>;

export const LangyMessageImportedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_IMPORTED),
  data: langyMessageImportedEventDataSchema,
});
export type LangyMessageImportedEvent = z.infer<
  typeof LangyMessageImportedEventSchema
>;

/**
 * AgentTurnAccepted — the user's turn was durably admitted for dispatch.
 *
 * `questionParts` carries the user's question that opened this turn, so the
 * per-turn document (langyConversationTurn) is self-contained — question AND
 * answer in one render doc — without a join back to message history. Optional:
 * an accepted turn without a captured question still records.
 */
export const langyAgentTurnAcceptedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  questionParts: z.array(langyMessagePartSchema).optional(),
});
export type LangyAgentTurnAcceptedEventData = z.infer<
  typeof langyAgentTurnAcceptedEventDataSchema
>;

export const LangyAgentTurnAcceptedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED),
  data: langyAgentTurnAcceptedEventDataSchema,
});
export type LangyAgentTurnAcceptedEvent = z.infer<
  typeof LangyAgentTurnAcceptedEventSchema
>;

/**
 * ToolCallInitiated — the agent began a tool call during a response. Recorded
 * as a meaningful transition (not a token) and treated as liveness.
 *
 * It carries WHAT THE CALL IS DOING, not merely that one happened. A tool name
 * on its own is close to worthless here: half of Langy's calls are `bash`, and
 * "the agent ran bash" answers nothing you would ever ask of an event log. The
 * command is the identity of the call — the thing you search for, the thing you
 * reproduce, the thing that tells you `bash` was really a trace search.
 *
 * `command` is the shell command when the tool is a shell (the overwhelmingly
 * common case, and the one worth having a first-class field for). `input` keeps
 * the full argument object for every other tool. Both are optional because a
 * frame that never surfaced its arguments must still be recordable — an event we
 * refuse to write is strictly worse than one that is missing a field.
 */
export const langyToolCallInitiatedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  command: z.string().optional(),
  input: langyJsonValueSchema.optional(),
});
export type LangyToolCallInitiatedEventData = z.infer<
  typeof langyToolCallInitiatedEventDataSchema
>;

export const LangyToolCallInitiatedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_INITIATED),
  data: langyToolCallInitiatedEventDataSchema,
});
export type LangyToolCallInitiatedEvent = z.infer<
  typeof LangyToolCallInitiatedEventSchema
>;

/**
 * ToolCallSucceeded — a tool call the agent initiated returned without error.
 *
 * Self-describing, exactly like its `initiated` twin: it repeats the `command`
 * so that ONE event answers "what ran, and how long did it take?" without a join
 * back to the start. Debugging a response is reading a list of these, and a list
 * that says only `bash` sends you hunting for the other half.
 *
 * `durationMs` is what turns the log into something you can find a slow call in
 * — the CLI spawn alone has been measured in the hundreds of milliseconds, and
 * you cannot chase that without a number. A tool call that errored is a distinct
 * event (`tool_call_failed`), so no `isError` boolean lives here.
 */
export const langyToolCallSucceededEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  command: z.string().optional(),
  input: langyJsonValueSchema.optional(),
  durationMs: z.number().optional(),
});
export type LangyToolCallSucceededEventData = z.infer<
  typeof langyToolCallSucceededEventDataSchema
>;

export const LangyToolCallSucceededEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED),
  data: langyToolCallSucceededEventDataSchema,
});
export type LangyToolCallSucceededEvent = z.infer<
  typeof LangyToolCallSucceededEventSchema
>;

/**
 * ToolCallFailed — a tool call the agent initiated returned an error. The
 * failing twin of `tool_call_succeeded`: a call reaches exactly one of the two.
 *
 * `errorText` keeps the failure itself, truncated, rather than a bare boolean
 * that tells you a thing broke but not why — the whole reason a failed call is
 * its own event is that the failure detail is worth first-class carriage.
 */
export const langyToolCallFailedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  command: z.string().optional(),
  input: langyJsonValueSchema.optional(),
  durationMs: z.number().optional(),
  errorText: z.string().optional(),
});
export type LangyToolCallFailedEventData = z.infer<
  typeof langyToolCallFailedEventDataSchema
>;

export const LangyToolCallFailedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_FAILED),
  data: langyToolCallFailedEventDataSchema,
});
export type LangyToolCallFailedEvent = z.infer<
  typeof LangyToolCallFailedEventSchema
>;

/**
 * PlanUpdated — a full snapshot of the agent's plan (its `todowrite` todo list)
 * during a turn. Snapshot-typed: `todowrite` rewrites the whole list per call, so
 * each event carries the entire list and the fold applies last-write-wins (by
 * occurredAt). One "meaningful transition" per todowrite call — the plan the
 * panel mirrors as a live checklist, now durable so the checklist survives a
 * reload from the fold. `status` is a permissive string (the client tolerates an
 * unknown value as pending), and `items` is capped/truncated at the manager.
 */
export const langyPlanItemSchema = z
  .record(z.string(), langyJsonValueSchema)
  .and(
    z.object({
      content: z.string(),
      status: z.string(),
    }),
  );
export type LangyPlanItemData = z.infer<typeof langyPlanItemSchema>;

export const langyPlanUpdatedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  items: z.array(langyPlanItemSchema).default([]),
});
export type LangyPlanUpdatedEventData = z.infer<
  typeof langyPlanUpdatedEventDataSchema
>;

export const LangyPlanUpdatedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.PLAN_UPDATED),
  data: langyPlanUpdatedEventDataSchema,
});
export type LangyPlanUpdatedEvent = z.infer<typeof LangyPlanUpdatedEventSchema>;

/**
 * AgentResponseFailed — the response's lifecycle failed with no answer to carry
 * (a stalled/orphaned response the liveness sweep terminalizes). Distinct from
 * `agent_responded`, which carries the completed answer.
 */
export const langyAgentResponseFailedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  error: z.string(),
});
export type LangyAgentResponseFailedEventData = z.infer<
  typeof langyAgentResponseFailedEventDataSchema
>;

export const LangyAgentResponseFailedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONSE_FAILED),
  data: langyAgentResponseFailedEventDataSchema,
});
export type LangyAgentResponseFailedEvent = z.infer<
  typeof LangyAgentResponseFailedEventSchema
>;

// NOTE: `status_reported` and `progress_reported` are EPHEMERAL signals, not
// durable events — they never reach `event_log` or any projection
// projection (ADR-046). Their PAYLOAD schemas live in `./ephemeral.ts` (the
// signal contract PR3's Redis transport implements), not here, because these
// schemas are for durable event-sourcing events.

/**
 * AgentResponded — the whole final answer of an agent response, the source of
 * truth. Streamed tokens are NOT events; this single event carries the complete
 * assistant message. Feeds operational state (terminal status, count) and the
 * assistant message projection.
 */
export const langyAgentRespondedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  messageId: z.string(),
  role: langyMessageRoleSchema.default("assistant"),
  parts: z.array(langyMessagePartSchema).default([]),
  outcome: z.enum(["completed", "failed"]).default("completed"),
  error: z.string().nullable().optional(),
});
export type LangyAgentRespondedEventData = z.infer<
  typeof langyAgentRespondedEventDataSchema
>;

export const LangyAgentRespondedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED),
  data: langyAgentRespondedEventDataSchema,
});
export type LangyAgentRespondedEvent = z.infer<
  typeof LangyAgentRespondedEventSchema
>;

/**
 * ConversationArchived — soft-delete. Flips the fold's status/ArchivedAt.
 * No ClickHouse hard-deletion (ADR-046, out of scope).
 */
export const langyConversationArchivedEventDataSchema = z.object({
  conversationId: z.string(),
});
export type LangyConversationArchivedEventData = z.infer<
  typeof langyConversationArchivedEventDataSchema
>;

export const LangyConversationArchivedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.ARCHIVED),
  data: langyConversationArchivedEventDataSchema,
});
export type LangyConversationArchivedEvent = z.infer<
  typeof LangyConversationArchivedEventSchema
>;

/**
 * ConversationMetadataUpdated — rename and/or share toggle. Beyond the
 * prescribed vocabulary; preserves the PATCH route (ADR-046 open question 1).
 * Any field left undefined is unchanged by the fold.
 */
export const langyConversationMetadataUpdatedEventDataSchema = z.object({
  conversationId: z.string(),
  title: z.string().nullable().optional(),
  isShared: z.boolean().optional(),
  sharedById: z.string().nullable().optional(),
});
export type LangyConversationMetadataUpdatedEventData = z.infer<
  typeof langyConversationMetadataUpdatedEventDataSchema
>;

export const LangyConversationMetadataUpdatedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.METADATA_UPDATED),
  data: langyConversationMetadataUpdatedEventDataSchema,
});
export type LangyConversationMetadataUpdatedEvent = z.infer<
  typeof LangyConversationMetadataUpdatedEventSchema
>;

/**
 * ConversationHandoffPending (ADR-048) — a turn checkpointed on pod termination
 * and left an opaque, worker-authored resume token. The fold stores the token
 * (PendingHandoffToken/PendingHandoffTurnId), clears CurrentTurnId (the turn
 * handed off, it did not fail), and returns the conversation to idle. The token
 * is OPAQUE to the pipeline — persisted verbatim, only opencode authors and
 * consumes it.
 */
export const langyConversationHandoffPendingEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  token: z.string(),
});
export type LangyConversationHandoffPendingEventData = z.infer<
  typeof langyConversationHandoffPendingEventDataSchema
>;

export const LangyConversationHandoffPendingEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING),
  version: z.literal(
    LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_PENDING,
  ),
  data: langyConversationHandoffPendingEventDataSchema,
});
export type LangyConversationHandoffPendingEvent = z.infer<
  typeof LangyConversationHandoffPendingEventSchema
>;

/**
 * ConversationHandoffConsumed (ADR-048) — the next turn threaded the pending
 * resume token to a fresh worker and cleared it from the fold. Idempotency on
 * the command collapses a double-consume to a single event.
 */
export const langyConversationHandoffConsumedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
});
export type LangyConversationHandoffConsumedEventData = z.infer<
  typeof langyConversationHandoffConsumedEventDataSchema
>;

export const LangyConversationHandoffConsumedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED),
  version: z.literal(
    LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_CONSUMED,
  ),
  data: langyConversationHandoffConsumedEventDataSchema,
});
export type LangyConversationHandoffConsumedEvent = z.infer<
  typeof LangyConversationHandoffConsumedEventSchema
>;

/**
 * ConversationTitleGenerated — a cheap-model auto title produced after a
 * finalized response by the process-outbox title effect. Updates operational
 * `Title` ONLY when `titleSource !== "user"` (a manual rename is sticky), and
 * marks the title source as `auto`. Carries the model that produced it
 * for provenance. No message row and no activity bump — it refines metadata,
 * it is not conversational activity.
 */
export const langyConversationTitleGeneratedEventDataSchema = z.object({
  conversationId: z.string(),
  /**
   * The finalized turn that triggered this regeneration, when known. Drives
   * idempotency: one title generation per turn, however many times the turn's
   * terminal event is delivered (finalize is at-least-once by design).
   */
  turnId: z.string().optional(),
  title: z.string(),
  /** Always "auto" today — the human rename path is conversation_metadata_updated. */
  source: z.literal("auto").default("auto"),
  /** provider/model id the title was generated with, e.g. "openai/gpt-5-mini". */
  model: z.string(),
});
export type LangyConversationTitleGeneratedEventData = z.infer<
  typeof langyConversationTitleGeneratedEventDataSchema
>;

export const LangyConversationTitleGeneratedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TITLE_GENERATED),
  data: langyConversationTitleGeneratedEventDataSchema,
});
export type LangyConversationTitleGeneratedEvent = z.infer<
  typeof LangyConversationTitleGeneratedEventSchema
>;

/**
 * Union of all langy-conversation-processing event types.
 */
export type LangyConversationProcessingEvent =
  | LangyConversationStartedEvent
  | LangyConversationForkedEvent
  | LangyMessageRecordedEvent
  | LangyMessageImportedEvent
  | LangyAgentTurnAcceptedEvent
  | LangyToolCallInitiatedEvent
  | LangyToolCallSucceededEvent
  | LangyToolCallFailedEvent
  | LangyPlanUpdatedEvent
  | LangyAgentResponseFailedEvent
  | LangyAgentRespondedEvent
  | LangyConversationArchivedEvent
  | LangyConversationMetadataUpdatedEvent
  | LangyConversationHandoffPendingEvent
  | LangyConversationHandoffConsumedEvent
  | LangyConversationTitleGeneratedEvent;

export {
  isLangyConversationStartedEvent,
  isLangyMessageRecordedEvent,
  isLangyAgentTurnAcceptedEvent,
  isLangyToolCallInitiatedEvent,
  isLangyToolCallSucceededEvent,
  isLangyToolCallFailedEvent,
  isLangyPlanUpdatedEvent,
  isLangyAgentResponseFailedEvent,
  isLangyAgentRespondedEvent,
  isLangyConversationArchivedEvent,
  isLangyConversationMetadataUpdatedEvent,
  isLangyConversationHandoffPendingEvent,
  isLangyConversationHandoffConsumedEvent,
  isLangyConversationTitleGeneratedEvent,
} from "./typeGuards";
