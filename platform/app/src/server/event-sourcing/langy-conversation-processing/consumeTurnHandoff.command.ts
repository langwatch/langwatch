import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import { langyConversationEvents } from "./events";

/**
 * ConsumeTurnHandoff -> conversationHandoffConsumed. Clears the pending token
 * once the next turn has threaded it to a fresh worker.
 */
export async function consumeTurnHandoff(
  input: z.infer<typeof langyConversationEvents.conversationHandoffConsumed>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "conversationHandoffConsumed", data: input }];
}
