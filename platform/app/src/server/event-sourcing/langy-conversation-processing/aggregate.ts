import { defineAggregate } from "@langwatch/event-sourcing";
import { z } from "zod";
import {
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

/**
 * The `langy_conversation` aggregate (ADR-105). The fold accumulators live in
 * `@langwatch/langy` — the same code the browser folds with — and are wired up
 * in `conversationState.fold.ts` and `conversationTurn.fold.ts`: one
 * aggregate, two folds (the conversation spine, and the per-turn document).
 *
 * Every event key derives its persisted `lw.langy_conversation.<action>`
 * string through `defineAggregate`'s `prefix`.
 */

const conversationStartedFromAcceptSchema =
  langyConversationStartedEventDataSchema.omit({ conversationId: true });
const userMessageFromAcceptSchema = langyMessageRecordedEventDataSchema.omit({
  conversationId: true,
});

export const langyConversation = defineAggregate("langy_conversation")
  .state(z.null(), () => null)
  .events({
    conversationStarted: {
      data: langyConversationStartedEventDataSchema,
      apply: (state) => state,
    },
    conversationForked: {
      data: langyConversationForkedEventDataSchema,
      apply: (state) => state,
    },
    messageRecorded: {
      data: langyMessageRecordedEventDataSchema,
      apply: (state) => state,
    },
    messageImported: {
      data: langyMessageImportedEventDataSchema,
      apply: (state) => state,
    },
    agentTurnAccepted: {
      data: langyAgentTurnAcceptedEventDataSchema,
      apply: (state) => state,
    },
    toolCallInitiated: {
      data: langyToolCallInitiatedEventDataSchema,
      apply: (state) => state,
    },
    toolCallSucceeded: {
      data: langyToolCallSucceededEventDataSchema,
      apply: (state) => state,
    },
    toolCallFailed: {
      data: langyToolCallFailedEventDataSchema,
      apply: (state) => state,
    },
    planUpdated: {
      data: langyPlanUpdatedEventDataSchema,
      apply: (state) => state,
    },
    agentResponseFailed: {
      data: langyAgentResponseFailedEventDataSchema,
      apply: (state) => state,
    },
    agentResponded: {
      data: langyAgentRespondedEventDataSchema,
      apply: (state) => state,
    },
    conversationArchived: {
      data: langyConversationArchivedEventDataSchema,
      apply: (state) => state,
    },
    conversationMetadataUpdated: {
      data: langyConversationMetadataUpdatedEventDataSchema,
      apply: (state) => state,
    },
    conversationHandoffPending: {
      data: langyConversationHandoffPendingEventDataSchema,
      apply: (state) => state,
    },
    conversationHandoffConsumed: {
      data: langyConversationHandoffConsumedEventDataSchema,
      apply: (state) => state,
    },
    conversationTitleGenerated: {
      data: langyConversationTitleGeneratedEventDataSchema,
      apply: (state) => state,
    },
  })
  .commands({
    createConversation: {
      input: langyConversationStartedEventDataSchema,
      handle: (_state, input, events) => [events.conversationStarted(input)],
    },
    forkConversation: {
      input: langyConversationForkedEventDataSchema,
      handle: (_state, input, events) => [events.conversationForked(input)],
    },
    recordMessage: {
      input: langyMessageRecordedEventDataSchema,
      handle: (_state, input, events) => [events.messageRecorded(input)],
    },
    importMessage: {
      input: langyMessageImportedEventDataSchema,
      handle: (_state, input, events) => [events.messageImported(input)],
    },
    /**
     * Atomically decides the accepted turn and, when resuming, the prior
     * handoff consumption as one ordered event batch, so a crash can never
     * commit the new turn while losing the durable consume.
     */
    acceptAgentTurn: {
      input: langyAgentTurnAcceptedEventDataSchema.extend({
        conversationStart: conversationStartedFromAcceptSchema.optional(),
        userMessage: userMessageFromAcceptSchema.optional(),
        consumeHandoffTurnId: z.string().optional(),
      }),
      handle: (_state, input, events) => {
        const { conversationStart, userMessage, consumeHandoffTurnId, ...accepted } = input;
        const out = [];
        if (conversationStart) {
          out.push(
            events.conversationStarted({
              conversationId: input.conversationId,
              ...conversationStart,
            }),
          );
        }
        if (userMessage) {
          out.push(
            events.messageRecorded({
              conversationId: input.conversationId,
              ...userMessage,
            }),
          );
        }
        out.push(events.agentTurnAccepted(accepted));
        if (consumeHandoffTurnId) {
          out.push(
            events.conversationHandoffConsumed({
              conversationId: input.conversationId,
              turnId: consumeHandoffTurnId,
            }),
          );
        }
        return out;
      },
    },
    initiateToolCall: {
      input: langyToolCallInitiatedEventDataSchema,
      handle: (_state, input, events) => [events.toolCallInitiated(input)],
    },
    succeedToolCall: {
      input: langyToolCallSucceededEventDataSchema,
      handle: (_state, input, events) => [events.toolCallSucceeded(input)],
    },
    failToolCall: {
      input: langyToolCallFailedEventDataSchema,
      handle: (_state, input, events) => [events.toolCallFailed(input)],
    },
    updatePlan: {
      input: langyPlanUpdatedEventDataSchema,
      handle: (_state, input, events) => [events.planUpdated(input)],
    },
    failAgentResponse: {
      input: langyAgentResponseFailedEventDataSchema,
      handle: (_state, input, events) => [events.agentResponseFailed(input)],
    },
    recordAgentResponse: {
      input: langyAgentRespondedEventDataSchema,
      handle: (_state, input, events) => [events.agentResponded(input)],
    },
    archiveConversation: {
      input: langyConversationArchivedEventDataSchema,
      handle: (_state, input, events) => [events.conversationArchived(input)],
    },
    updateConversationMetadata: {
      input: langyConversationMetadataUpdatedEventDataSchema,
      handle: (_state, input, events) => [events.conversationMetadataUpdated(input)],
    },
    recordTurnHandoff: {
      input: langyConversationHandoffPendingEventDataSchema,
      handle: (_state, input, events) => [
        events.conversationHandoffPending(input),
      ],
    },
    consumeTurnHandoff: {
      input: langyConversationHandoffConsumedEventDataSchema,
      handle: (_state, input, events) => [
        events.conversationHandoffConsumed(input),
      ],
    },
    generateConversationTitle: {
      input: langyConversationTitleGeneratedEventDataSchema,
      handle: (_state, input, events) => [events.conversationTitleGenerated(input)],
    },
  })
  .build();

export type LangyConversationAggregate = typeof langyConversation;
export type LangyConversationCommandName = keyof LangyConversationAggregate["commands"];
