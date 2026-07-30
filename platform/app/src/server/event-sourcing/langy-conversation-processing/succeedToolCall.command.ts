import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import type { langyConversationEvents } from "./events";

/** SucceedToolCall -> toolCallSucceeded (a durable response milestone). */
export async function succeedToolCall(
  input: z.infer<typeof langyConversationEvents.toolCallSucceeded>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "toolCallSucceeded", data: input }];
}
