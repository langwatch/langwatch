import type { EmittedEvent } from "@langwatch/event-sourcing";
import { z } from "zod";
import { langyConversationEvents } from "./events";

const conversationStartFromAcceptSchema =
  langyConversationEvents.conversationStarted.omit({
    conversationId: true,
    occurredAt: true,
  });
const userMessageFromAcceptSchema = langyConversationEvents.messageRecorded.omit(
  { conversationId: true, occurredAt: true },
);

export const acceptAgentTurnInputSchema =
  langyConversationEvents.agentTurnAccepted.extend({
    conversationStart: conversationStartFromAcceptSchema.optional(),
    userMessage: userMessageFromAcceptSchema.optional(),
    consumeHandoffTurnId: z.string().optional(),
  });

export type AcceptAgentTurnInput = z.infer<typeof acceptAgentTurnInputSchema>;

/**
 * AcceptAgentTurn atomically records the accepted turn and, when resuming,
 * the conversation start / opening message it seeds and the prior handoff it
 * consumes — one ordered batch, so a crash can never commit the new turn
 * while losing the durable consume it depended on.
 */
export async function acceptAgentTurn(
  input: AcceptAgentTurnInput,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  const { conversationStart, userMessage, consumeHandoffTurnId, ...accepted } =
    input;
  const events: EmittedEvent<typeof langyConversationEvents>[] = [];

  if (conversationStart) {
    events.push({
      type: "conversationStarted",
      data: {
        conversationId: input.conversationId,
        occurredAt: input.occurredAt,
        ...conversationStart,
      },
    });
  }
  if (userMessage) {
    events.push({
      type: "messageRecorded",
      data: {
        conversationId: input.conversationId,
        occurredAt: input.occurredAt,
        ...userMessage,
      },
    });
  }
  events.push({ type: "agentTurnAccepted", data: accepted });
  if (consumeHandoffTurnId) {
    events.push({
      type: "conversationHandoffConsumed",
      data: {
        conversationId: input.conversationId,
        turnId: consumeHandoffTurnId,
        occurredAt: input.occurredAt,
      },
    });
  }
  return events;
}
