import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import { langyConversationEvents } from "./events";

/**
 * FailAgentResponse -> agentResponseFailed. The terminal a stalled/orphaned
 * response reaches when there is no answer to carry (the liveness sweep
 * drains it). Distinct from recordAgentResponse/agentResponded, which
 * carries the completed answer.
 */
export async function failAgentResponse(
  input: z.infer<typeof langyConversationEvents.agentResponseFailed>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "agentResponseFailed", data: input }];
}
