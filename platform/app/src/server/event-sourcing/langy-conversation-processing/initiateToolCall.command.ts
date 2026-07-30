import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import { langyConversationEvents } from "./events";

/** InitiateToolCall -> toolCallInitiated (a durable response milestone). */
export async function initiateToolCall(
  input: z.infer<typeof langyConversationEvents.toolCallInitiated>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "toolCallInitiated", data: input }];
}
