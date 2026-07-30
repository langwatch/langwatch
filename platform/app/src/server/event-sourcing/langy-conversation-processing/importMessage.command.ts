import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import type { langyConversationEvents } from "./events";

/** ImportMessage -> messageImported (history copy, never a live turn). */
export async function importMessage(
  input: z.infer<typeof langyConversationEvents.messageImported>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "messageImported", data: input }];
}
