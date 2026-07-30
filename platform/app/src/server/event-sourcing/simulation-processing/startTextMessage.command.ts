import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { simulationRunEvents } from "./events";
import type { TextMessageStartData } from "./schema";

export async function startTextMessage(
  input: TextMessageStartData,
): Promise<readonly EmittedEvent<typeof simulationRunEvents>[]> {
  return [{ type: "textMessageStart", data: input }];
}
