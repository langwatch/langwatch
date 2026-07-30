import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import { langyConversationEvents } from "./events";

/**
 * RecordTurnHandoff -> conversationHandoffPending. Persists the opaque,
 * worker-authored resume token for a turn that checkpointed on pod
 * termination.
 */
export async function recordTurnHandoff(
  input: z.infer<typeof langyConversationEvents.conversationHandoffPending>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "conversationHandoffPending", data: input }];
}
