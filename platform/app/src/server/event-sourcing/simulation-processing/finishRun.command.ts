import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { simulationRunEvents } from "./events";
import type { RunFinishedData } from "./schema";

export async function finishRun(
  input: RunFinishedData,
): Promise<readonly EmittedEvent<typeof simulationRunEvents>[]> {
  return [{ type: "finished", data: input }];
}
