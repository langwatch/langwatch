import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import { langyConversationEvents } from "./events";

/** ArchiveConversation -> conversationArchived (soft-delete). */
export async function archiveConversation(
  input: z.infer<typeof langyConversationEvents.conversationArchived>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "conversationArchived", data: input }];
}
