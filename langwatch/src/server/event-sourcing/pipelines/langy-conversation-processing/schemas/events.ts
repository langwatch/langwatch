/**
 * Full durable event schemas for the `langy_conversation` aggregate: the
 * server's branded event envelope (`EventSchema` — TenantId, AggregateType,
 * ids, timestamps) closed over each event's `type`/`version` literal and its
 * PAYLOAD schema.
 *
 * The payload schemas — the `data` half, and everything a browser fold needs —
 * live in `@langwatch/langy` (ADR-059). This module is the server-only half:
 * the envelope carries domain branding that has no business in a client
 * bundle, so the composition happens here and only here.
 */
import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  langyAgentResponseFailedEventDataSchema,
  langyAgentRespondedEventDataSchema,
  langyAgentTurnAcceptedEventDataSchema,
  langyConversationArchivedEventDataSchema,
  langyConversationForkedEventDataSchema,
  langyConversationHandoffConsumedEventDataSchema,
  langyConversationHandoffPendingEventDataSchema,
  langyConversationMetadataUpdatedEventDataSchema,
  langyConversationStartedEventDataSchema,
  langyConversationTitleGeneratedEventDataSchema,
  langyMessageImportedEventDataSchema,
  langyMessageRecordedEventDataSchema,
  langyPlanUpdatedEventDataSchema,
  langyToolCallFailedEventDataSchema,
  langyToolCallInitiatedEventDataSchema,
  langyToolCallSucceededEventDataSchema,
} from "@langwatch/langy";

export const LangyConversationStartedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_STARTED),
  data: langyConversationStartedEventDataSchema,
});
export type LangyConversationStartedEvent = z.infer<
  typeof LangyConversationStartedEventSchema
>;

export const LangyConversationForkedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_FORKED),
  data: langyConversationForkedEventDataSchema,
});
export type LangyConversationForkedEvent = z.infer<
  typeof LangyConversationForkedEventSchema
>;

export const LangyMessageRecordedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_RECORDED),
  data: langyMessageRecordedEventDataSchema,
});
export type LangyMessageRecordedEvent = z.infer<
  typeof LangyMessageRecordedEventSchema
>;

export const LangyMessageImportedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_IMPORTED),
  data: langyMessageImportedEventDataSchema,
});
export type LangyMessageImportedEvent = z.infer<
  typeof LangyMessageImportedEventSchema
>;

export const LangyAgentTurnAcceptedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED),
  data: langyAgentTurnAcceptedEventDataSchema,
});
export type LangyAgentTurnAcceptedEvent = z.infer<
  typeof LangyAgentTurnAcceptedEventSchema
>;

export const LangyToolCallInitiatedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_INITIATED),
  data: langyToolCallInitiatedEventDataSchema,
});
export type LangyToolCallInitiatedEvent = z.infer<
  typeof LangyToolCallInitiatedEventSchema
>;

export const LangyToolCallSucceededEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED),
  data: langyToolCallSucceededEventDataSchema,
});
export type LangyToolCallSucceededEvent = z.infer<
  typeof LangyToolCallSucceededEventSchema
>;

export const LangyToolCallFailedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_FAILED),
  data: langyToolCallFailedEventDataSchema,
});
export type LangyToolCallFailedEvent = z.infer<
  typeof LangyToolCallFailedEventSchema
>;

export const LangyPlanUpdatedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.PLAN_UPDATED),
  data: langyPlanUpdatedEventDataSchema,
});
export type LangyPlanUpdatedEvent = z.infer<typeof LangyPlanUpdatedEventSchema>;

export const LangyAgentResponseFailedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONSE_FAILED),
  data: langyAgentResponseFailedEventDataSchema,
});
export type LangyAgentResponseFailedEvent = z.infer<
  typeof LangyAgentResponseFailedEventSchema
>;

// NOTE: `status_reported` and `progress_reported` are EPHEMERAL signals, not
// durable events — they never reach `event_log` or any projection (ADR-046).
// Their PAYLOAD schemas live in `../ephemeral.ts` (the signal contract PR3's
// Redis transport implements), not here, because these schemas are for durable
// event-sourcing events.

export const LangyAgentRespondedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED),
  data: langyAgentRespondedEventDataSchema,
});
export type LangyAgentRespondedEvent = z.infer<
  typeof LangyAgentRespondedEventSchema
>;

export const LangyConversationArchivedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.ARCHIVED),
  data: langyConversationArchivedEventDataSchema,
});
export type LangyConversationArchivedEvent = z.infer<
  typeof LangyConversationArchivedEventSchema
>;

export const LangyConversationMetadataUpdatedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.METADATA_UPDATED),
  data: langyConversationMetadataUpdatedEventDataSchema,
});
export type LangyConversationMetadataUpdatedEvent = z.infer<
  typeof LangyConversationMetadataUpdatedEventSchema
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
