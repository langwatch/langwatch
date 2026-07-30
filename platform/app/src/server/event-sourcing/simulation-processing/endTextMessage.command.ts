import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { simulationRunEvents } from "./events";
import type { TextMessageEndData } from "./schema";

export async function endTextMessage(
  input: TextMessageEndData,
): Promise<readonly EmittedEvent<typeof simulationRunEvents>[]> {
  return [{ type: "textMessageEnd", data: input }];
}
