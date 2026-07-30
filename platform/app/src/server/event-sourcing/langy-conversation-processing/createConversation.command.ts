import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import type { langyConversationEvents } from "./events";

/** CreateConversation -> conversationStarted (explicit creation). */
export async function createConversation(
  input: z.infer<typeof langyConversationEvents.conversationStarted>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "conversationStarted", data: input }];
}
