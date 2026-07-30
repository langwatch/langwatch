import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { simulationRunEvents } from "./events";
import type { RunStartedData } from "./schema";

export async function startRun(
  input: RunStartedData,
): Promise<readonly EmittedEvent<typeof simulationRunEvents>[]> {
  return [{ type: "started", data: input }];
}
