import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import { langyConversationEvents } from "./events";

/** ForkConversation -> conversationForked (new aggregate with source lineage). */
export async function forkConversation(
  input: z.infer<typeof langyConversationEvents.conversationForked>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "conversationForked", data: input }];
}
