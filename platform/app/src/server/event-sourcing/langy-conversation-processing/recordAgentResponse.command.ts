import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import { langyConversationEvents } from "./events";

/**
 * RecordAgentResponse -> agentResponded (the whole final answer, source of
 * truth).
 */
export async function recordAgentResponse(
  input: z.infer<typeof langyConversationEvents.agentResponded>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "agentResponded", data: input }];
}
