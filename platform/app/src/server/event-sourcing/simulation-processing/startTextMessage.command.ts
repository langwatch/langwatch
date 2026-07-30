import type { EmittedEvent } from "@langwatch/event-sourcing";
import { simulationRunEvents } from "./events";
import type { TextMessageStartData } from "./schema";

export async function startTextMessage(
  input: TextMessageStartData,
): Promise<readonly EmittedEvent<typeof simulationRunEvents>[]> {
  return [{ type: "textMessageStart", data: input }];
}
