import type { EmittedEvent } from "@langwatch/event-sourcing";
import { simulationRunEvents } from "./events";
import type { TextMessageEndData } from "./schema";

export async function endTextMessage(
  input: TextMessageEndData,
): Promise<readonly EmittedEvent<typeof simulationRunEvents>[]> {
  return [{ type: "textMessageEnd", data: input }];
}
