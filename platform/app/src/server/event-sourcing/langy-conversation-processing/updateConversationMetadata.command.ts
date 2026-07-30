import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import { langyConversationEvents } from "./events";

/** UpdateConversationMetadata -> conversationMetadataUpdated (rename/share). */
export async function updateConversationMetadata(
  input: z.infer<typeof langyConversationEvents.conversationMetadataUpdated>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "conversationMetadataUpdated", data: input }];
}
