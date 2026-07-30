import {
  langyAgentRespondedEventDataSchema,
  langyAgentResponseFailedEventDataSchema,
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
import { z } from "zod";

/**
 * `prefix` + camelCase key derive `lw.langy_conversation.<snake_case>` byte-
 * equal to `LANGY_CONVERSATION_EVENT_TYPES` in `@langwatch/langy` — those
 * strings are the durable wire vocabulary and are not this
 * pipeline's alone to move (see `packages/langy/src/constants.ts`).
 */
export const LANGY_CONVERSATION_PIPELINE_NAME = "langy_conversation";
export const LANGY_CONVERSATION_PIPELINE_PREFIX = "lw";

/**
 * Every payload gains `occurredAt`: the shared `@langwatch/langy` fold
 * reducers (`foldLangyConversationState`/`foldLangyConversationTurn`) are
 * business-time driven (monotone activity bumps, first-wins timestamps), and
 * a `.withFold`/`.withMap` handler here receives only `(state, data)` — no
 * envelope. Business time has to travel as a declared field or those
 * reducers have nothing to read.
 */
const withOccurredAt = <Schema extends z.ZodRawShape>(
  schema: z.ZodObject<Schema>,
) => schema.extend({ occurredAt: z.number() });

export const langyConversationEvents = {
  conversationStarted: withOccurredAt(langyConversationStartedEventDataSchema),
  conversationForked: withOccurredAt(langyConversationForkedEventDataSchema),
  messageRecorded: withOccurredAt(langyMessageRecordedEventDataSchema),
  messageImported: withOccurredAt(langyMessageImportedEventDataSchema),
  agentTurnAccepted: withOccurredAt(langyAgentTurnAcceptedEventDataSchema),
  toolCallInitiated: withOccurredAt(langyToolCallInitiatedEventDataSchema),
  toolCallSucceeded: withOccurredAt(langyToolCallSucceededEventDataSchema),
  toolCallFailed: withOccurredAt(langyToolCallFailedEventDataSchema),
  planUpdated: withOccurredAt(langyPlanUpdatedEventDataSchema),
  agentResponseFailed: withOccurredAt(langyAgentResponseFailedEventDataSchema),
  agentResponded: withOccurredAt(langyAgentRespondedEventDataSchema),
  conversationArchived: withOccurredAt(
    langyConversationArchivedEventDataSchema,
  ),
  conversationMetadataUpdated: withOccurredAt(
    langyConversationMetadataUpdatedEventDataSchema,
  ),
  conversationHandoffPending: withOccurredAt(
    langyConversationHandoffPendingEventDataSchema,
  ),
  conversationHandoffConsumed: withOccurredAt(
    langyConversationHandoffConsumedEventDataSchema,
  ),
  conversationTitleGenerated: withOccurredAt(
    langyConversationTitleGeneratedEventDataSchema,
  ),
} as const;
