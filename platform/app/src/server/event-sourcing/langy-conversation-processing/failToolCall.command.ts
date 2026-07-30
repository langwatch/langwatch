import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import { langyConversationEvents } from "./events";

/**
 * FailToolCall -> toolCallFailed (a durable response milestone). The failing
 * terminal of a tool call; a call reaches exactly one of succeed/fail.
 */
export async function failToolCall(
  input: z.infer<typeof langyConversationEvents.toolCallFailed>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "toolCallFailed", data: input }];
}
