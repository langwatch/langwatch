import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { z } from "zod";
import type { langyConversationEvents } from "./events";

/**
 * UpdatePlan -> planUpdated (a durable snapshot of the agent's todo list).
 * Snapshot-typed, last-write-wins on the turn fold.
 */
export async function updatePlan(
  input: z.infer<typeof langyConversationEvents.planUpdated>,
): Promise<readonly EmittedEvent<typeof langyConversationEvents>[]> {
  return [{ type: "planUpdated", data: input }];
}
