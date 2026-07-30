import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import { langyConversationEvents } from "./events";

/** RecordMessage -> messageRecorded. */
export async function recordMessage(
  input: z.infer<typeof langyConversationEvents.messageRecorded>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "messageRecorded", data: input }];
}
