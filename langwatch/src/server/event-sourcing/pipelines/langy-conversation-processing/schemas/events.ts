import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "./constants";
import { langyMessagePartSchema, langyMessageRoleSchema } from "./shared";

/**
 * MessageSent — a user (or system) message was added to the conversation.
 * Feeds both the fold (owner, title, activity, count) and the map projection
 * (the langy_messages row). `parts` is opaque to the pipeline.
 */
export const langyMessageSentEventDataSchema = z.object({
  conversationId: z.string(),
  /** Owner of the conversation. Set on the fold from the first message only. */
  userId: z.string(),
  messageId: z.string(),
  role: langyMessageRoleSchema,
  parts: z.array(langyMessagePartSchema).default([]),
  /** Derived from the first user message; the fold keeps the first non-empty. */
  title: z.string().nullable().optional(),
});
export type LangyMessageSentEventData = z.infer<
  typeof langyMessageSentEventDataSchema
>;

export const LangyMessageSentEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_SENT),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_SENT),
  data: langyMessageSentEventDataSchema,
});
export type LangyMessageSentEvent = z.infer<typeof LangyMessageSentEventSchema>;

/**
 * AgentTurnStarted — the assistant began working on the user's latest message.
 */
export const langyAgentTurnStartedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
});
export type LangyAgentTurnStartedEventData = z.infer<
  typeof langyAgentTurnStartedEventDataSchema
>;

export const LangyAgentTurnStartedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_STARTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_STARTED),
  data: langyAgentTurnStartedEventDataSchema,
});
export type LangyAgentTurnStartedEvent = z.infer<
  typeof LangyAgentTurnStartedEventSchema
>;

/**
 * ToolCallStarted — PR3 seam. The agent began a tool call during a turn.
 * Recorded as a meaningful transition (not a token) and treated as liveness.
 */
export const langyToolCallStartedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
});
export type LangyToolCallStartedEventData = z.infer<
  typeof langyToolCallStartedEventDataSchema
>;

export const LangyToolCallStartedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_STARTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_STARTED),
  data: langyToolCallStartedEventDataSchema,
});
export type LangyToolCallStartedEvent = z.infer<
  typeof LangyToolCallStartedEventSchema
>;

/**
 * ToolCallCompleted — PR3 seam. A tool call the agent started has returned.
 */
export const langyToolCallCompletedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  isError: z.boolean().optional(),
});
export type LangyToolCallCompletedEventData = z.infer<
  typeof langyToolCallCompletedEventDataSchema
>;

export const LangyToolCallCompletedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_COMPLETED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_COMPLETED),
  data: langyToolCallCompletedEventDataSchema,
});
export type LangyToolCallCompletedEvent = z.infer<
  typeof LangyToolCallCompletedEventSchema
>;

/**
 * AgentResponded — PR3 seam. An intermediate assistant response within a turn.
 * The final answer is carried by `turn_finalized`, so this does not append a
 * message row in PR2 — it only bumps activity.
 */
export const langyAgentRespondedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
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
 * AgentTurnCompleted — PR3 seam. The turn's lifecycle completed cleanly.
 * `turn_finalized` carries the answer; this is the fold's terminal marker.
 */
export const langyAgentTurnCompletedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
});
export type LangyAgentTurnCompletedEventData = z.infer<
  typeof langyAgentTurnCompletedEventDataSchema
>;

export const LangyAgentTurnCompletedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_COMPLETED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_COMPLETED),
  data: langyAgentTurnCompletedEventDataSchema,
});
export type LangyAgentTurnCompletedEvent = z.infer<
  typeof LangyAgentTurnCompletedEventSchema
>;

/**
 * AgentTurnFailed — PR3 seam. The turn's lifecycle failed.
 */
export const langyAgentTurnFailedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  error: z.string(),
});
export type LangyAgentTurnFailedEventData = z.infer<
  typeof langyAgentTurnFailedEventDataSchema
>;

export const LangyAgentTurnFailedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_FAILED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_FAILED),
  data: langyAgentTurnFailedEventDataSchema,
});
export type LangyAgentTurnFailedEvent = z.infer<
  typeof LangyAgentTurnFailedEventSchema
>;

// NOTE: `status_reported` and `progress_reported` are EPHEMERAL signals, not
// durable events — they never reach `event_log`, the fold, or the map
// projection (ADR-046). Their PAYLOAD schemas live in `./ephemeral.ts` (the
// signal contract PR3's Redis transport implements), not here, because these
// schemas are for durable event-sourcing events.

/**
 * TurnFinalized — the whole final answer of an agent turn, the source of truth.
 * Streamed tokens are NOT events; this single event carries the complete
 * assistant message. Feeds the fold (terminal status, count) and the map
 * projection (the assistant langy_messages row).
 */
export const langyTurnFinalizedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  messageId: z.string(),
  role: langyMessageRoleSchema.default("assistant"),
  parts: z.array(langyMessagePartSchema).default([]),
  outcome: z.enum(["completed", "failed"]).default("completed"),
  error: z.string().nullable().optional(),
});
export type LangyTurnFinalizedEventData = z.infer<
  typeof langyTurnFinalizedEventDataSchema
>;

export const LangyTurnFinalizedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TURN_FINALIZED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TURN_FINALIZED),
  data: langyTurnFinalizedEventDataSchema,
});
export type LangyTurnFinalizedEvent = z.infer<
  typeof LangyTurnFinalizedEventSchema
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
 * Union of all langy-conversation-processing event types.
 */
export type LangyConversationProcessingEvent =
  | LangyMessageSentEvent
  | LangyAgentTurnStartedEvent
  | LangyToolCallStartedEvent
  | LangyToolCallCompletedEvent
  | LangyAgentRespondedEvent
  | LangyAgentTurnCompletedEvent
  | LangyAgentTurnFailedEvent
  | LangyTurnFinalizedEvent
  | LangyConversationArchivedEvent
  | LangyConversationMetadataUpdatedEvent;

export {
  isLangyMessageSentEvent,
  isLangyAgentTurnStartedEvent,
  isLangyToolCallStartedEvent,
  isLangyToolCallCompletedEvent,
  isLangyAgentRespondedEvent,
  isLangyAgentTurnCompletedEvent,
  isLangyAgentTurnFailedEvent,
  isLangyTurnFinalizedEvent,
  isLangyConversationArchivedEvent,
  isLangyConversationMetadataUpdatedEvent,
} from "./typeGuards";
