import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import type { langyConversationEvents } from "./events";

/**
 * GenerateConversationTitle -> conversationTitleGenerated (auto title).
 * Dispatched after a successful agent-response boundary while the title is
 * still derived.
 */
export async function generateConversationTitle(
  input: z.infer<typeof langyConversationEvents.conversationTitleGenerated>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "conversationTitleGenerated", data: input }];
}
