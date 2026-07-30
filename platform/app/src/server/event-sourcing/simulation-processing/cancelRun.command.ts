import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { simulationRunEvents } from "./events";
import type { CancelRequestedData } from "./schema";

export async function cancelRun(
  input: CancelRequestedData,
): Promise<readonly EmittedEvent<typeof simulationRunEvents>[]> {
  return [{ type: "cancelRequested", data: input }];
}
